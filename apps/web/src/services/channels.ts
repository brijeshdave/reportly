// Author: Brijesh Dave <https://github.com/brijeshdave>
// Contact-channel calls, for the signed-in user's own account. Verification is
// always self-service: only the person holding the address can prove it, so there
// is no administrator equivalent of these.
import type { Channel, ChannelCodeSent, ChannelStatus, ChannelTestResult } from "@reportly/shared";

import { http } from "@/services/http.js";

export function fetchMyChannels(): Promise<ChannelStatus[]> {
  return http.get<ChannelStatus[]>("/me/channels");
}

export function requestChannelCode(channel: Channel): Promise<ChannelCodeSent> {
  return http.post<ChannelCodeSent>("/me/channels/verify/request", { channel });
}

export function confirmChannelCode(channel: Channel, code: string): Promise<ChannelStatus[]> {
  return http.post<ChannelStatus[]>("/me/channels/verify/confirm", { channel, code });
}

export type { ChannelTestResult };

/**
 * Send one test message now. Without a destination it goes to your own verified
 * one for that channel.
 */
export function testChannel(channel: Channel, destination?: string): Promise<ChannelTestResult> {
  return http.post<ChannelTestResult>("/channels/test", { channel, destination });
}
