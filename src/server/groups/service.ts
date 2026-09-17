import "server-only";

import { createGroupService } from "./group-service";
import type {
  CreateGroupInput,
  CreateInviteInput,
  GroupRepository,
  JoinGroupInput,
  LeaveGroupInput,
} from "./group-repository";

/**
 * Keep the database adapter behind the request boundary. Besides avoiding a
 * database connection during route discovery, this makes the domain service
 * explicitly depend on the existing Drizzle/session setup.
 */
const lazyDrizzleRepository: GroupRepository = {
  async createGroupWithMember(input: CreateGroupInput) {
    const { drizzleGroupRepository } = await import(
      "./drizzle-group-repository"
    );
    return drizzleGroupRepository.createGroupWithMember(input);
  },

  async listGroupsForMember(userId: string) {
    const { drizzleGroupRepository } = await import(
      "./drizzle-group-repository"
    );
    return drizzleGroupRepository.listGroupsForMember(userId);
  },

  async getGroupForMember(groupId: string, userId: string) {
    const { drizzleGroupRepository } = await import(
      "./drizzle-group-repository"
    );
    return drizzleGroupRepository.getGroupForMember(groupId, userId);
  },

  async createInviteForMember(input: CreateInviteInput) {
    const { drizzleGroupRepository } = await import(
      "./drizzle-group-repository"
    );
    return drizzleGroupRepository.createInviteForMember(input);
  },

  async joinWithInvite(input: JoinGroupInput) {
    const { drizzleGroupRepository } = await import(
      "./drizzle-group-repository"
    );
    return drizzleGroupRepository.joinWithInvite(input);
  },

  async leaveGroup(input: LeaveGroupInput) {
    const { drizzleGroupRepository } = await import(
      "./drizzle-group-repository"
    );
    return drizzleGroupRepository.leaveGroup(input);
  },
};

/**
 * Production group service. Transactional lifecycle persistence lives in the
 * Drizzle repository; the optional domain hook is not used by this adapter.
 */
export const groupService = createGroupService(lazyDrizzleRepository);
