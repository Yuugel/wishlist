Set-StrictMode -Version 2.0

if ($null -eq ('WishlistHotkeyMessagePump' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class WishlistHotkeySnapshot
{
    public string Text { get; private set; }
    public string Error { get; private set; }

    public WishlistHotkeySnapshot(string text, string error)
    {
        Text = text;
        Error = error;
    }
}

public sealed class WishlistHotkeyMessagePump : IDisposable
{
    private const UInt32 WmQuit = 0x0012;
    private const UInt32 WmHotkey = 0x0312;
    private const UInt32 PmNoRemove = 0x0000;
    private const UInt32 CfUnicodeText = 13;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr HWnd;
        public UInt32 Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public UInt32 Time;
        public Int32 PointX;
        public Int32 PointY;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, UInt32 modifiers, UInt32 virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out NativeMessage message, IntPtr hWnd, UInt32 filterMin, UInt32 filterMax);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PeekMessage(out NativeMessage message, IntPtr hWnd, UInt32 filterMin, UInt32 filterMax, UInt32 removeMessage);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostThreadMessage(UInt32 threadId, UInt32 message, UIntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern UInt32 GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenClipboard(IntPtr newOwner);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsClipboardFormatAvailable(UInt32 format);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetClipboardData(UInt32 format);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr memory);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalUnlock(IntPtr memory);

    private readonly object _sync = new object();
    private readonly AutoResetEvent _ready = new AutoResetEvent(false);
    private readonly AutoResetEvent _hotkeySignal = new AutoResetEvent(false);
    private readonly Queue<WishlistHotkeySnapshot> _pendingHotkeys = new Queue<WishlistHotkeySnapshot>();
    private readonly int _hotkeyId;
    private readonly UInt32 _modifiers;
    private readonly UInt32 _virtualKey;
    private Thread _thread;
    private volatile UInt32 _threadId;
    private bool _registered;
    private volatile bool _stopRequested;
    private bool _disposed;
    private volatile string _status = "CREATED";
    private int _errorCode;

    public WishlistHotkeyMessagePump(int hotkeyId, UInt32 modifiers, UInt32 virtualKey)
    {
        _hotkeyId = hotkeyId;
        _modifiers = modifiers;
        _virtualKey = virtualKey;
    }

    public string Status { get { return _status; } }
    public int ErrorCode { get { return _errorCode; } }
    public UInt32 ThreadId { get { return _threadId; } }

    public void Start()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                throw new ObjectDisposedException("WishlistHotkeyMessagePump");
            }
            if (_thread != null)
            {
                throw new InvalidOperationException("The hotkey message pump can only be started once.");
            }

            _thread = new Thread(RunMessageLoop);
            _thread.Name = "Wishlist Hotkey Message Pump";
            _thread.IsBackground = false;
            _thread.Start();
        }
    }

    public bool WaitForReady(int timeoutMilliseconds)
    {
        return _ready.WaitOne(timeoutMilliseconds);
    }

    public bool WaitForHotkey(int timeoutMilliseconds)
    {
        return _hotkeySignal.WaitOne(timeoutMilliseconds);
    }

    public bool TryTakeHotkey()
    {
        lock (_sync)
        {
            if (_pendingHotkeys.Count == 0)
            {
                return false;
            }

            _pendingHotkeys.Dequeue();
            return true;
        }
    }

    public WishlistHotkeySnapshot TryTakeHotkeySnapshot()
    {
        lock (_sync)
        {
            if (_pendingHotkeys.Count == 0)
            {
                return null;
            }
            return _pendingHotkeys.Dequeue();
        }
    }

    // Test-only seam: injects a WM_HOTKEY into the same queue used by GetMessage.
    public bool PostTestHotkey()
    {
        return PostMessage(WmHotkey);
    }

    // Test-only seam: schedules one deterministic queue message without SendInput.
    public bool ScheduleTestHotkey(int delayMilliseconds)
    {
        if (delayMilliseconds < 0)
        {
            throw new ArgumentOutOfRangeException("delayMilliseconds");
        }

        Thread testThread = new Thread(delegate()
        {
            Thread.Sleep(delayMilliseconds);
            PostTestHotkey();
        });
        testThread.Name = "Wishlist Hotkey Lifecycle Test";
        testThread.IsBackground = true;
        testThread.Start();
        return true;
    }

    public void Stop()
    {
        Thread thread;
        UInt32 threadId;
        lock (_sync)
        {
            _stopRequested = true;
            thread = _thread;
            threadId = _threadId;
        }

        if (threadId != 0)
        {
            PostMessage(WmQuit);
        }
        _hotkeySignal.Set();

        if (thread != null && thread != Thread.CurrentThread)
        {
            thread.Join(5000);
        }
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
        }

        Stop();
        _ready.Dispose();
        _hotkeySignal.Dispose();
    }

    private bool PostMessage(UInt32 message)
    {
        UInt32 threadId = _threadId;
        if (threadId == 0)
        {
            return false;
        }

        UIntPtr wParam = message == WmHotkey
            ? (UIntPtr)(UInt64)(UInt32)_hotkeyId
            : UIntPtr.Zero;
        return PostThreadMessage(threadId, message, wParam, IntPtr.Zero);
    }

    private void RunMessageLoop()
    {
        try
        {
            _threadId = GetCurrentThreadId();
            NativeMessage ignoredMessage;
            // A thread message queue must exist before PostThreadMessage can target it.
            PeekMessage(out ignoredMessage, IntPtr.Zero, 0, 0, PmNoRemove);

            _registered = RegisterHotKey(IntPtr.Zero, _hotkeyId, _modifiers, _virtualKey);
            if (!_registered)
            {
                _errorCode = Marshal.GetLastWin32Error();
                _status = "FAILED";
                _ready.Set();
                _hotkeySignal.Set();
                return;
            }

            _status = "READY";
            _ready.Set();

            while (!_stopRequested)
            {
                NativeMessage message;
                int messageResult = GetMessage(out message, IntPtr.Zero, 0, 0);
                if (messageResult == -1)
                {
                    _errorCode = Marshal.GetLastWin32Error();
                    _status = "FAILED";
                    break;
                }
                if (messageResult == 0)
                {
                    _status = _stopRequested ? "STOPPED" : "QUIT";
                    break;
                }

                if (message.Message == WmHotkey && message.WParam.ToUInt64() == (UInt64)(UInt32)_hotkeyId)
                {
                    WishlistHotkeySnapshot snapshot = CaptureClipboardSnapshot();
                    lock (_sync)
                    {
                        _pendingHotkeys.Enqueue(snapshot);
                    }
                    _hotkeySignal.Set();
                }
            }
        }
        catch (Exception exception)
        {
            _errorCode = exception.HResult;
            _status = "FAILED";
            _ready.Set();
            _hotkeySignal.Set();
        }
        finally
        {
            if (_registered)
            {
                UnregisterHotKey(IntPtr.Zero, _hotkeyId);
                _registered = false;
            }
            if (_status == "READY")
            {
                _status = "STOPPED";
            }
            _threadId = 0;
            _ready.Set();
            _hotkeySignal.Set();
        }
    }

    private WishlistHotkeySnapshot CaptureClipboardSnapshot()
    {
        bool opened = false;
        for (int attempt = 0; attempt < 5 && !opened; attempt++)
        {
            opened = OpenClipboard(IntPtr.Zero);
            if (!opened)
            {
                Thread.Sleep(10);
            }
        }
        if (!opened)
        {
            return new WishlistHotkeySnapshot(null, "Clipboard could not be opened at hotkey time.");
        }

        try
        {
            if (!IsClipboardFormatAvailable(CfUnicodeText))
            {
                return new WishlistHotkeySnapshot(null, "Clipboard did not contain Unicode text at hotkey time.");
            }
            IntPtr handle = GetClipboardData(CfUnicodeText);
            if (handle == IntPtr.Zero)
            {
                return new WishlistHotkeySnapshot(null, "Clipboard text handle was unavailable at hotkey time.");
            }
            IntPtr pointer = GlobalLock(handle);
            if (pointer == IntPtr.Zero)
            {
                return new WishlistHotkeySnapshot(null, "Clipboard text could not be locked at hotkey time.");
            }
            try
            {
                return new WishlistHotkeySnapshot(Marshal.PtrToStringUni(pointer), null);
            }
            finally
            {
                GlobalUnlock(handle);
            }
        }
        finally
        {
            CloseClipboard();
        }
    }
}
'@
}

function New-WishlistHotkeyMessagePump {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][int]$HotkeyId,
        [Parameter(Mandatory = $true)][uint32]$ModifierFlags,
        [Parameter(Mandatory = $true)][uint32]$VirtualKey
    )

    return New-Object -TypeName WishlistHotkeyMessagePump -ArgumentList $HotkeyId, $ModifierFlags, $VirtualKey
}

Export-ModuleMember -Function New-WishlistHotkeyMessagePump
