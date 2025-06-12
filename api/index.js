import { createRequestHandler } from "@vercel/remix";
import * as build from "../build/index.js";

export default createRequestHandler({ build, mode: "production" });