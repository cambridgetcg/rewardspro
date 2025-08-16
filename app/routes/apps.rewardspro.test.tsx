import { json, type LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  
  return json({
    success: true,
    message: "Proxy is working!",
    timestamp: new Date().toISOString(),
    received_params: queryParams,
    headers: Object.fromEntries(request.headers.entries()),
    url: request.url,
    method: request.method
  });
}