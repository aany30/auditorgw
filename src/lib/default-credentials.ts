interface MetaCreds {
  accessToken: string;
  businessId: string;
}

interface DV360Creds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  advertiserId: string;
  partnerId?: string;
}

export function resolveMetaCreds(body: Record<string, unknown>): MetaCreds | null {
  const accessToken = (body.accessToken as string) || process.env.DEFAULT_META_ACCESS_TOKEN || "";
  const businessId = (body.businessId as string) || process.env.DEFAULT_META_BUSINESS_ID || "";
  if (!accessToken || !businessId) return null;
  return { accessToken, businessId };
}

export function resolveDV360Creds(body: Record<string, unknown>): DV360Creds | null {
  const clientId = (body.clientId as string) || process.env.DEFAULT_DV360_CLIENT_ID || "";
  const clientSecret = (body.clientSecret as string) || process.env.DEFAULT_DV360_CLIENT_SECRET || "";
  const refreshToken = (body.refreshToken as string) || process.env.DEFAULT_DV360_REFRESH_TOKEN || "";
  const advertiserId = (body.advertiserId as string) || process.env.DEFAULT_DV360_ADVERTISER_ID || "";
  const partnerId = (body.partnerId as string) || process.env.DEFAULT_DV360_PARTNER_ID || undefined;
  if (!refreshToken || !advertiserId) return null;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, refreshToken, advertiserId, partnerId };
}
