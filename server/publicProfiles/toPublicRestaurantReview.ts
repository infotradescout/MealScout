export function toPublicRestaurantReview(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const { id, restaurantId, reviewText, comment, createdAt, user } = row;
  const publicUser =
    user && typeof user === "object" && !Array.isArray(user)
      ? {
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          profileImageUrl: user.profileImageUrl ?? null,
        }
      : null;

  return {
    id,
    restaurantId,
    reviewText: reviewText ?? comment ?? null,
    comment: comment ?? reviewText ?? null,
    createdAt,
    user: publicUser,
  };
}

export function toPublicRestaurantReviewArray(
  rows: any[],
): Record<string, unknown>[] {
  return Array.isArray(rows) ? rows.map(toPublicRestaurantReview) : [];
}
