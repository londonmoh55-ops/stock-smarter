import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy cargo bons UI retired — pre-arrival is the source of truth. */
export const Route = createFileRoute("/bons")({
  beforeLoad: () => {
    throw redirect({ to: "/pre-arrival" });
  },
});
