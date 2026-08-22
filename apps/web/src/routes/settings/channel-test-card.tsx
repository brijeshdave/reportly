// Author: Brijesh Dave <https://github.com/brijeshdave>
// Prove a channel actually works, from the screen where it is configured.
//
// The reason this is not a nicety: `cli doctor` once reported that the relay
// "accepted the connection" while the provider was refusing every single message
// for an unauthorised sending domain. A handshake proves reachability; only a real
// send exercises the API key, the from-address and the recipient rules together.
//
// So this sends one message, now, and shows the provider's own words — refusal
// included — rather than a tidy "something went wrong".
import { CHANNELS, type Channel } from "@reportly/shared";
import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";

import { Alert, Field, Input } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { testChannel, type ChannelTestResult } from "@/services/channels.js";

const LABELS: Record<Channel, string> = {
  email: "Email",
  mobile: "SMS",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
};

export function ChannelTestCard({ disabled }: { disabled?: boolean }) {
  const [channel, setChannel] = useState<Channel>("email");
  const [destination, setDestination] = useState("");
  const [result, setResult] = useState<ChannelTestResult | null>(null);

  const send = useMutation({
    mutationFn: () => testChannel(channel, destination.trim() || undefined),
    onSuccess: setResult,
  });

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold">Send a test message</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sends one message now and shows exactly what the provider answered. A connection test is not
        a delivery test — a provider can accept the connection and then refuse every message, which
        is invisible until somebody says they never got their invitation.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {send.error ? <ErrorAlert error={send.error} /> : null}

        {result ? (
          result.delivered ? (
            <Alert tone="success">
              Sent to {result.destination}. If it does not arrive, the provider accepted it and
              something after that dropped it — check the provider's own logs.
            </Alert>
          ) : (
            <Alert tone="error">
              <span className="font-medium">Refused for {result.destination}.</span>
              {/* The provider's words, whole: this text is usually the entire
                  diagnosis, and summarising it is how a week gets lost. */}
              <span className="mt-1 block whitespace-pre-wrap break-words font-mono text-xs">
                {result.error}
              </span>
            </Alert>
          )
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Channel">
            {(props) => (
              <select
                {...props}
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value as Channel);
                  setResult(null);
                }}
                disabled={disabled || send.isPending}
                className="h-9 rounded-xl border border-border bg-card px-3 text-sm"
              >
                {CHANNELS.map((option) => (
                  <option key={option} value={option}>
                    {LABELS[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="flex-1">
            <Field label="Send to (optional)">
              {(props) => (
                <Input
                  {...props}
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  placeholder="Your own verified destination"
                  disabled={disabled || send.isPending}
                />
              )}
            </Field>
          </div>

          <Button size="sm" onClick={() => send.mutate()} disabled={disabled || send.isPending}>
            <Send className="h-4 w-4" />
            Send test
          </Button>
        </div>
      </div>
    </Card>
  );
}
