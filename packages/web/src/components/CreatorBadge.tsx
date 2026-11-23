import { TbFillHeart, TbOutlineBrandDiscord, TbOutlineBrandGithub } from 'solid-icons/tb';
import { Show, createSignal } from 'solid-js';

export const GITHUB_USERNAME = 'qjuzo';
export const DISCORD_USER_ID = '219968676785291264';
export const AVATAR_URL = `https://github.com/${GITHUB_USERNAME}.png`;
export const GITHUB_URL = `https://github.com/${GITHUB_USERNAME}`;
export const DISCORD_URL = `https://discord.com/users/${DISCORD_USER_ID}`;

export interface CreatorBadgeProps {
  onSecretTap?: () => void;
}

export function CreatorBadge(props: CreatorBadgeProps) {
  const [avatarFailed, setAvatarFailed] = createSignal(false);

  return (
    <div class="creator-badge" aria-label={`Created by @${GITHUB_USERNAME}`}>
      <div class="creator-identity">
        <div class="creator-avatar-wrap" tabindex="0">
          <Show
            when={!avatarFailed()}
            fallback={
              <span class="creator-fallback mono" aria-hidden="true">
                {GITHUB_USERNAME.slice(0, 2).toUpperCase()}
              </span>
            }
          >
            <img
              src={AVATAR_URL}
              alt={`@${GITHUB_USERNAME} avatar`}
              class="creator-avatar"
              width="28"
              height="28"
              loading="lazy"
              onError={() => setAvatarFailed(true)}
            />
          </Show>
          <span class="creator-presence" aria-hidden="true" />
          <span class="avatar-bubble mono">psst... try pasting a crooked QR code</span>
        </div>

        <span class="creator-copy">
          <span>made with Solid &amp; stubborn math by</span>
          <span class="creator-handle mono">@{GITHUB_USERNAME}</span>
          <button
            type="button"
            class="heart-btn"
            aria-label="Creator signature heart"
            onClick={() => props.onSecretTap?.()}
          >
            <TbFillHeart size={13} class="maker-heart" aria-hidden="true" />
          </button>
        </span>
      </div>

      <div class="creator-links">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          class="creator-pill"
          aria-label={`GitHub profile @${GITHUB_USERNAME}`}
        >
          <TbOutlineBrandGithub size={14} aria-hidden="true" />
          <span>GitHub</span>
        </a>

        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          class="creator-pill"
          aria-label="Add on Discord"
        >
          <TbOutlineBrandDiscord size={14} aria-hidden="true" />
          <span>Discord</span>
          <span class="creator-tooltip mono">Add on Discord</span>
        </a>
      </div>
    </div>
  );
}
