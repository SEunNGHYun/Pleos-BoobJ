type Coordinate = {latitude: number; longitude: number};
const coordinate = (point: Coordinate) => `${point.longitude},${point.latitude}`;

export async function waypointRoute(
 origin: Coordinate, destination: Coordinate, waypoint: Coordinate, key: string,
): Promise<{distanceMeters: number; durationSeconds: number} | null> {
 const url = new URL('https://apis-navi.kakaomobility.com/v1/directions');
 url.search = new URLSearchParams({
  origin: coordinate(origin), destination: coordinate(destination), waypoints: coordinate(waypoint),
  priority: 'DISTANCE', summary: 'true',
 }).toString();
 try {
  const response = await fetch(url, {
   headers: {Authorization: `KakaoAK ${key}`},
   signal: AbortSignal.timeout(2500),
   redirect: 'error',
  });
  if (!response.ok) return null;
  const body = await response.json();
  const route = body?.routes?.[0];
  const distanceMeters = route?.summary?.distance;
  const durationSeconds = route?.summary?.duration;
  if (route?.result_code !== 0 || !Number.isSafeInteger(distanceMeters) || distanceMeters < 0) return null;
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0) return null;
  return {distanceMeters, durationSeconds};
 } catch {
  return null;
 }
}
