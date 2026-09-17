import "server-only";

import { createTakeoverService } from "./takeover-service";
import type {
  TakeoverMutationInput,
  TakeoverRepository,
  TakeoverStatus,
} from "./takeover-repository";

const lazyDrizzleRepository: TakeoverRepository = {
  async reserve(input: TakeoverMutationInput) {
    const { drizzleTakeoverRepository } = await import(
      "./drizzle-takeover-repository"
    );
    return drizzleTakeoverRepository.reserve(input);
  },

  async transition(
    input: TakeoverMutationInput & {
      from: TakeoverStatus;
      to: TakeoverStatus;
    },
  ) {
    const { drizzleTakeoverRepository } = await import(
      "./drizzle-takeover-repository"
    );
    return drizzleTakeoverRepository.transition(input);
  },

  async release(input: TakeoverMutationInput) {
    const { drizzleTakeoverRepository } = await import(
      "./drizzle-takeover-repository"
    );
    return drizzleTakeoverRepository.release(input);
  },

  async getViewerStatus(input: { wishId: string; actorId: string }) {
    const { drizzleTakeoverRepository } = await import(
      "./drizzle-takeover-repository"
    );
    return drizzleTakeoverRepository.getViewerStatus(input);
  },
};

export const takeoverService = createTakeoverService(lazyDrizzleRepository);
