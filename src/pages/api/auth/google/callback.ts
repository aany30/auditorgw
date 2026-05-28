import { NextApiRequest, NextApiResponse } from 'next';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

interface GoogleAdsCustomer {
  resourceName: string;
  id: string;
  descriptiveName: string;
}

interface GoogleAdsCustomerResponse {
  resource: GoogleAdsCustomer | null;
}

interface GoogleAnalyticsProperty {
  name: string;
  displayName: string;
}

interface GoogleAnalyticsListResponse {
  properties: GoogleAnalyticsProperty[];
}

interface GoogleTagManagerContainer {
  name: string;
  publicId: string;
}

interface GoogleTagManagerResponse {
  container: GoogleTagManagerContainer | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  try {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

    if (!clientId || !clientSecret) {
      console.error('Missing Google OAuth configuration');
      return res.redirect('/?error=missing_config');
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: code as string,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      console.error('Google token exchange failed:', error);
      return res.redirect('/?error=token_exchange_failed');
    }

    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
    const accessToken = tokenData.access_token;

    let customerId = '';
    let propertyId = '';
    let containerId = '';

    // Try to fetch Google Ads customer ID
    try {
      const customerResponse = await fetch('https://googleads.googleapis.com/v15/customers:listAccessibleCustomers', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (customerResponse.ok) {
        const customerData = (await customerResponse.json()) as { resource_names: string[] };
        if (customerData.resource_names && customerData.resource_names.length > 0) {
          customerId = customerData.resource_names[0].split('/')[1];
        }
      }
    } catch (error) {
      console.warn('Failed to fetch Google Ads customer ID:', error);
    }

    // Try to fetch GA4 property ID
    try {
      const propertiesResponse = await fetch(
        'https://analyticsadmin.googleapis.com/v1alpha/properties?filter=parent:organizations/',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (propertiesResponse.ok) {
        const propertiesData = (await propertiesResponse.json()) as GoogleAnalyticsListResponse;
        if (propertiesData.properties && propertiesData.properties.length > 0) {
          propertyId = propertiesData.properties[0].name.split('/')[1];
        }
      }
    } catch (error) {
      console.warn('Failed to fetch GA4 property ID:', error);
    }

    // Try to fetch GTM container ID
    try {
      const containerResponse = await fetch('https://www.googleapis.com/tagmanager/v2/accounts', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (containerResponse.ok) {
        const containerData = (await containerResponse.json()) as { account: any[] };
        if (containerData.account && containerData.account.length > 0) {
          if (containerData.account[0].container && containerData.account[0].container.length > 0) {
            containerId = containerData.account[0].container[0].publicId;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to fetch GTM container ID:', error);
    }

    // Redirect to dashboard with token and IDs
    res.redirect(
      `/app/dashboard?google_token=${encodeURIComponent(
        accessToken
      )}&customer_id=${customerId}&property_id=${propertyId}&container_id=${containerId}`
    );
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/?error=oauth_error');
  }
}
