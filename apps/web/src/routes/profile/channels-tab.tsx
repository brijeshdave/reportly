// Author: Brijesh Dave <https://github.com/brijeshdave>
// Your contact channels, and proving them. Verification lives here and nowhere
// else: the whole point is that the person holds the address, so an administrator
// marking it verified would prove nothing. Email is always available; the rest
// need a provider configured, and an unavailable channel says so rather than
// offering a button that cannot work.
import { confirmChannelCodeSchema, type Channel, type ChannelStatus } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageCircle, Phone, Send, Mail } from "lucide-react";
import { useState } from "react";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
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
  const [sent, setSent] = useState(false);
  const Icon = ICON[status.channel];

  const request = useMutation({
    mutationFn: () => requestChannelCode(status.channel),
    onSuccess: () => setSent(true),
  });

  // Only the `code` half of the route's schema: the channel is this row, not
  // something typed, and a form should validate what it draws. A wrong or lapsed
  // code is the refusal this actually gets, and it is about the code — so it
  // belongs under the box rather than in a banner above it.
  const confirm = useForm({
    schema: confirmChannelCodeSchema.pick({ code: true }),
    initial: { code: "" },
    submit: (input) => confirmChannelCode(status.channel, (input as { code: string }).code),
    onSuccess: async () => {
      setSent(false);
      confirm.reset({ code: "" });
      await queryClient.invalidateQueries({ queryKey: ["me", "channels"] });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

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
        <form {...confirm.formProps} className="flex flex-col gap-2">
          <Alert tone="info">We sent a code to {status.destination}. Enter it below.</Alert>
          {/* Whatever could not be blamed on the code — too many tries, a lapsed send. */}
          {confirm.formError ? <ErrorAlert error={confirm.formError} /> : null}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Code" required error={confirm.errorFor("code")}>
                {(props) => (
                  <Input
                    {...props}
                    {...confirm.register("code")}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    disabled={confirm.submitting}
                  />
                )}
              </Field>
            </div>
            <Button type="submit" size="sm" className="mb-0.5" disabled={confirm.submitting}>
              {confirm.submitting ? <Spinner /> : null}
              Confirm
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
