import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy receive route — redirects to Pre Arrival editor */
export const Route = createFileRoute("/import")({
  beforeLoad: () => {
    throw redirect({ to: "/pre-arrival/$bonId", params: { bonId: "new" } });
  },
  component: () => null,
});
