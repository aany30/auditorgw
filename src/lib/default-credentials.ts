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

interface GoogleAdsCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  developerToken: string;
  loginCustomerId?: string;
}

export function resolveGoogleAdsCreds(body: Record<string, unknown>): GoogleAdsCreds | null {
  const clientId = (body.clientId as string) || process.env.DEFAULT_DV360_CLIENT_ID || "";
  const clientSecret = (body.clientSecret as string) || process.env.DEFAULT_DV360_CLIENT_SECRET || "";
  const refreshToken = (body.refreshToken as string) || process.env.DEFAULT_DV360_REFRESH_TOKEN || "";
  const customerId = (body.customerId as string) || process.env.DEFAULT_GOOGLE_ADS_CUSTOMER_ID || "";
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
  const loginCustomerId = (body.loginCustomerId as string) || process.env.DEFAULT_GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined;
  if (!clientId || !clientSecret || !refreshToken || !customerId || !developerToken) return null;
  return { clientId, clientSecret, refreshToken, customerId, developerToken, loginCustomerId };
}

interface SnapchatCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  adAccountId: string;
  orgId?: string;
}

export function resolveSnapchatCreds(body: Record<string, unknown>): SnapchatCreds | null {
  const clientId = (body.clientId as string) || process.env.SNAPCHAT_CLIENT_ID || "";
  const clientSecret = (body.clientSecret as string) || process.env.SNAPCHAT_CLIENT_SECRET || "";
  const refreshToken = (body.refreshToken as string) || process.env.SNAPCHAT_REFRESH_TOKEN || "";
  const adAccountId = (body.adAccountId as string) || process.env.DEFAULT_SNAPCHAT_AD_ACCOUNT_ID || "";
  const orgId = (body.orgId as string) || process.env.DEFAULT_SNAPCHAT_ORG_ID || undefined;
  if (!clientId || !clientSecret || !refreshToken || !adAccountId) return null;
  return { clientId, clientSecret, refreshToken, adAccountId, orgId };
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
