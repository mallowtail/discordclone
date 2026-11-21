// Runs once in the browser before the app becomes interactive (Next.js instrumentation-client):
// start sending uncaught errors and unhandled promise rejections to the built-in error log.
import { installErrorCapture } from "@/lib/errors/clientReporter";

try {
  installErrorCapture(window);
} catch {
  // error capture must never break the page
}
