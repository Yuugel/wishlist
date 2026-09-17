import "server-only";

import { createWishService } from "./wish-service";
import type {
  CreateWishRepositoryInput,
  UpdateWishRepositoryInput,
  WishRepository,
} from "./wish-repository";

const lazyDrizzleRepository: WishRepository = {
  async createWish(input: CreateWishRepositoryInput) {
    const { drizzleWishRepository } = await import(
      "./drizzle-wish-repository"
    );
    return drizzleWishRepository.createWish(input);
  },

  async listWishesForOwner(ownerId: string) {
    const { drizzleWishRepository } = await import(
      "./drizzle-wish-repository"
    );
    return drizzleWishRepository.listWishesForOwner(ownerId);
  },

  async updateWish(input: UpdateWishRepositoryInput) {
    const { drizzleWishRepository } = await import(
      "./drizzle-wish-repository"
    );
    return drizzleWishRepository.updateWish(input);
  },

  async deleteWish(input: { wishId: string; ownerId: string; now: Date }) {
    const { drizzleWishRepository } = await import(
      "./drizzle-wish-repository"
    );
    return drizzleWishRepository.deleteWish(input);
  },
};

export const wishService = createWishService(lazyDrizzleRepository);
