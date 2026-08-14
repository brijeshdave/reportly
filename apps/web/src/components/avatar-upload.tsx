// Author: Brijesh Dave <https://github.com/brijeshdave>
// Choose, replace or remove a profile picture. Used on your own account, and by an
// administrator on someone else's.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Avatar } from "@/components/avatar.js";
import { Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button } from "@/components/ui/primitives.js";
import { resizeToAvatar } from "@/lib/resize-image.js";
import { removeAvatar, uploadAvatar } from "@/services/avatars.js";

export function AvatarUpload({
  userId,
  name,
  version,
  canEdit,
}: {
  userId: string;
  name: string;
  version: number | null | undefined;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<Error | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["users"] });
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.invalidateQueries({ queryKey: ["departments"] });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => uploadAvatar(userId, await resizeToAvatar(file)),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => removeAvatar(userId),
    onSuccess: refresh,
  });

  const choose = async (file: File | undefined) => {
    setFailed(null);
    if (!file) return;
    try {
      await upload.mutateAsync(file);
    } catch (error) {
      // A file the browser cannot decode never reaches the server, so it has no
      // API error to show — say so here rather than fail silently.
      if (!(error as { status?: number }).status) {
        setFailed(new Error("That file could not be read as an image."));
      }
    }
  };

  const busy = upload.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <Avatar userId={userId} name={name} version={version} size="xl" />

        {canEdit ? (
          <div className="flex flex-col gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Profile picture"
              className="hidden"
              onChange={(event) => void choose(event.target.files?.[0])}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {upload.isPending ? <Spinner /> : null}
                {version ? "Change picture" : "Upload picture"}
              </Button>
              {version ? (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => remove.mutate()}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG or WebP. Cropped to a square and shrunk to 256px in your browser.
            </p>
          </div>
        ) : null}
      </div>

      {upload.error && (upload.error as { status?: number }).status ? (
        <ErrorAlert error={upload.error} />
      ) : null}
      {failed ? <ErrorAlert error={failed} /> : null}
      {remove.error ? <ErrorAlert error={remove.error} /> : null}
    </div>
  );
}
