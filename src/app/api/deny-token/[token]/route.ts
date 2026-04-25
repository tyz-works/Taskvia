import { handleTokenDecision } from "@/lib/approval-handler";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handleTokenDecision(token, "denied");
}
