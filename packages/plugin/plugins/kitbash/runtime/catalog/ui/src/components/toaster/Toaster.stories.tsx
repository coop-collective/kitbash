import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { Button } from "../button/Button.tsx";
import { Toaster, toast } from "./Toaster.tsx";
import type { ToasterProps } from "./Toaster.tsx";

const meta = {
  title: "Components/Feedback/Toaster",
  component: Toaster,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Calm toasts from anywhere. Render one `<Toaster/>` near the root, then call `toast()`, `toast.success()`, `toast.needsYou()` or `toast.promise()` from any module. Toasts stack with only their molded top edges showing and fan out on hover or focus, which also pauses their timers. Pull one sideways: it resists while seated, then pops free past a detent. Escape or Delete dismisses the focused toast, and every toast is announced through a polite live region (errors through an assertive one).",
      },
    },
  },
  args: { position: "bottom-right", peek: 3, expand: false },
  argTypes: {
    position: { control: "select", options: ["bottom-right", "bottom-left", "bottom-center", "top-right", "top-center"] },
  },
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** A stand-in app window: the toaster is `contained` so the toasts land inside the preview frame. */
function Frame({ host, seed, ...props }: ToasterProps & { host: string; seed?: (host: string) => void }) {
  useEffect(() => {
    seed?.(host);
    return () => toast.clear(host);
  }, [host, seed]);
  return (
    <div className="kb-part" style={{ position: "relative", width: 640, height: 420, overflow: "hidden", padding: 20 }}>
      <p style={{ margin: "0 0 4px", fontWeight: 600 }}>Atlas workspace</p>
      <p style={{ margin: "0 0 16px", color: "var(--kb-ink-2)", fontSize: "var(--kb-text-sm)" }}>
        Fire a toast from any of these actions.
      </p>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <Button size="sm" icon="check" onClick={() => toast.success("Prompt saved", { toaster: host, description: "Version 14 is now live for the support agent." })}>
          Save prompt
        </Button>
        <Button
          size="sm"
          icon="play"
          onClick={() =>
            toast.promise(wait(2200).then(() => 212), {
              toaster: host,
              loading: "Running eval suite",
              description: "214 cases against gpt-5-mini",
              success: (passed) => `${passed} of 214 cases passed`,
              error: "Eval run failed",
            })
          }
        >
          Run evals
        </Button>
        <Button
          size="sm"
          icon="bell"
          onClick={() =>
            toast.needsYou("Atlas wants to send 38 emails", {
              toaster: host,
              description: "Renewal reminders to the Q4 churn-risk list.",
              action: { label: "Review", onClick: () => toast.info("Opened the outbox", { toaster: host }) },
            })
          }
        >
          Ask for approval
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon="alert"
          onClick={() =>
            toast.promise(wait(1600).then(() => Promise.reject(new Error("429"))), {
              toaster: host,
              loading: "Syncing Linear issues",
              success: "Synced",
              error: "Linear sync hit a rate limit, retrying in 60s",
            })
          }
        >
          Sync Linear
        </Button>
      </div>
      <Toaster id={host} contained {...props} />
    </div>
  );
}

function seedStack(host: string) {
  toast.success("Deploy finished", { toaster: host, description: "support-agent v2.8 is serving 100% of traffic.", duration: Infinity });
  toast("Memory compacted", { toaster: host, description: "Merged 41 notes into 6.", duration: Infinity });
  toast.needsYou("Refund over $500 needs sign-off", {
    toaster: host,
    description: "Order 88213, $742.10, requested by Atlas.",
    action: { label: "Review", onClick: () => undefined },
  });
}

export const Default: Story = {
  render: (args) => <Frame {...args} host="toaster-default" seed={seedStack} />,
};

export const FannedOut: Story = {
  args: { expand: true },
  render: (args) => <Frame {...args} host="toaster-fanned" seed={seedStack} />,
};

function seedPromise(host: string) {
  toast.promise(wait(1200).then(() => "3 files"), {
    toaster: host,
    loading: "Indexing repository",
    description: "kitbash/feature-registry on main",
    success: (n) => `Indexed ${n}, 2,184 chunks`,
    error: "Indexing failed",
  });
}

export const PromiseToast: Story = {
  render: (args) => <Frame {...args} host="toaster-promise" seed={seedPromise} />,
};

export const TopCenter: Story = {
  args: { position: "top-center" },
  render: (args) => <Frame {...args} host="toaster-top" seed={seedStack} />,
};
