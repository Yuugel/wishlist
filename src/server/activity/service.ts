import "server-only";

import { createActivityService } from "./activity-service";
import type { ActivityRepository } from "./activity-repository";

const lazyDrizzleRepository: ActivityRepository = {
  async listForRecipient(recipientId: string) {
    const { drizzleActivityRepository } = await import(
      "./drizzle-activity-repository"
    );
    return drizzleActivityRepository.listForRecipient(recipientId);
  },
};

export const activityService = createActivityService(lazyDrizzleRepository);
