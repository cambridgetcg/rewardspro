import { createRequestHandler } from "@remix-run/node";
import * as build from "../build/server/index.js";  // Your compiled Remix app

export default createRequestHandler({
  build,
  mode: process.env.NODE_ENV,
});