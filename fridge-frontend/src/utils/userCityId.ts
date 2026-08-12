/** cityId из JWT — строка; из /api/auth/me — populate { _id, name, code } */
export type UserCityRef =
  | string
  | { _id: string; name?: string; code?: string }
  | null
  | undefined;

export function resolveUserCityId(cityId: UserCityRef): string | undefined {
  if (cityId == null) return undefined;
  if (typeof cityId === 'string') {
    const trimmed = cityId.trim();
    return trimmed && trimmed !== '[object Object]' ? trimmed : undefined;
  }
  if (typeof cityId === 'object' && cityId._id) {
    return String(cityId._id);
  }
  return undefined;
}

export function resolveUserCityName(
  cityId: UserCityRef,
  cities: Array<{ _id: string; name: string }>,
): string | undefined {
  const id = resolveUserCityId(cityId);
  if (!id) return undefined;
  return cities.find((c) => c._id === id)?.name;
}
