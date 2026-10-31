import { removeVersionEverywhere } from '@server/lib/versions';

export async function removeRequestServiceGrants(
  serviceType: 'radarr' | 'sonarr',
  serviceId: number
): Promise<void> {
  await removeVersionEverywhere(`${serviceType}:${serviceId}`);
}
