import PasswordGate from "./PasswordGate";
import TrackerApp from "./TrackerApp";
import { hasValidPageSession } from "./lib/password-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const authorized = await hasValidPageSession();
  return authorized ? <TrackerApp /> : <PasswordGate />;
}
