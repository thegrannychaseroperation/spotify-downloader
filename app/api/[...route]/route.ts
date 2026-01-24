import { handleApiRequest } from "../../../src/api/router";

export async function GET(request: Request) {
  return handleApiRequest(request);
}

export async function POST(request: Request) {
  return handleApiRequest(request);
}

export async function DELETE(request: Request) {
  return handleApiRequest(request);
}

export async function OPTIONS(request: Request) {
  return handleApiRequest(request);
}
