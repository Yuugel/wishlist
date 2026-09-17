import "server-only";

import { createVisibilityService } from "./visibility-service";
import type { VisibilityRepository } from "./visibility-repository";

const lazyDrizzleRepository: VisibilityRepository = {
  async getGroupForMember(groupId: string, userId: string) {
    const { drizzleGroupRepository } = await import(
      "../groups/drizzle-group-repository"
    );
    return drizzleGroupRepository.getGroupForMember(groupId, userId);
  },

  async listWishesForMemberInGroup(groupId: string, userId: string) {
    const { drizzleVisibilityRepository } = await import(
      "./drizzle-visibility-repository"
    );
    return drizzleVisibilityRepository.listWishesForMemberInGroup(
      groupId,
      userId,
    );
  },
};

export const visibilityService = createVisibilityService(lazyDrizzleRepository);
