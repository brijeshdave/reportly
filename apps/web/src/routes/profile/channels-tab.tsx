// Author: Brijesh Dave <https://github.com/brijeshdave>
// Your contact channels, and proving them. Verification lives here and nowhere
// else: the whole point is that the person holds the address, so an administrator
// marking it verified would prove nothing. Email is always available; the rest
// need a provider configured, and an unavailable channel says so rather than
// offering a button that cannot work.
import { type Channel, type ChannelStatus } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageCircle, Phone, Send, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import { confirmChannelCode, fetchMyChannels, requestChannelCode } from "@/services/channels.js";

const LABEL: Record<Channel, string> = {
  email: "Email",
  mobile: "Mobile (SMS)",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
};

const ICON: Record<Channel, typeof Mail> = {
  email: Mail,
  mobile: Phone,
  whatsapp: MessageCircle,
  telegram: Send,
  discord: MessageCircle,
};

export function ChannelsTab() {
  const channels = useQuery({ queryKey: ["me", "channels"], queryFn: fetchMyChannels });

  if (channels.isLoading) return <Spinner />;
  if (channels.error) return <ErrorAlert error={channels.error} />;

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Only your email is required. Add the rest under Users if you manage your own record, or ask
        an administrator — then prove each one here.
      </p>
      {(channels.data ?? []).map((status) => (
        <ChannelRow key={status.channel} status={status} />
      ))}
    </div>
  );
}

function ChannelRow({ status }: { status: ChannelStatus }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const Icon = ICON[status.channel];

  const request = useMutation({
    mutationFn: () => requestChannelCode(status.channel),
    onSuccess: () => setSent(true),
  });

  const confirm = useMutation({
    mutationFn: () => confirmChannelCode(status.channel, code.trim()),
    onSuccess: async () => {
      setSent(false);
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["me", "channels"] });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    confirm.mutate();
  };

  // Nothing to verify without an address to send to.
  const addressed = status.destination !== null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{LABEL[status.channel]}</p>
          <p className="truncate text-xs text-muted-foreground">
            {status.destination ?? "Not set"}
          </p>
        </div>

        {status.verified ? (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" />
            Verified
          </Badge>
        ) : addressed && status.available ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => request.mutate()}
            disabled={request.isPending}
          >
            {request.isPending ? <Spinner /> : null}
            {sent ? "Resend code" : "Verify"}
          </Button>
        ) : (
          <Badge tone="neutral">{addressed ? "Unavailable" : "Not set"}</Badge>
        )}
      </div>

      {/* Why a channel that has an address still cannot be verified. */}
      {addressed && !status.available && !status.verified ? (
        <p className="text-xs text-muted-foreground">
          No provider is configured for {LABEL[status.channel]}. An administrator can set one up
          under Settings → Channels.
        </p>
      ) : null}

      {request.error ? <ErrorAlert error={request.error} /> : null}

      {sent && !status.verified ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Alert tone="info">We sent a code to {status.destination}. Enter it below.</Alert>
          {confirm.error ? <ErrorAlert error={confirm.error} /> : null}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Code">
                {(props) => (
                  <Input
                    {...props}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    disabled={confirm.isPending}
                  />
                )}
              </Field>
            </div>
            <Button
              type="submit"
              size="sm"
              className="mb-0.5"
              disabled={confirm.isPending || code.trim() === ""}
            >
              {confirm.isPending ? <Spinner /> : null}
              Confirm
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
