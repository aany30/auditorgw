import type { NextApiRequest, NextApiResponse } from "next";

/**
 * This is a placeholder API route for tRPC server.
 * In production, tRPC routes will be handled by Cloudflare Workers.
 * This file enables local development with Next.js API routes.
 */

type ResponseData = {
  message: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  res.status(200).json({ message: "tRPC routes configured in Cloudflare Workers" });
}
