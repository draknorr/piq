"use client";

import Hls from "hls.js";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Loader2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { opportunityPost } from "../../lib/api";
import type { OpportunityGalleryItem } from "../../lib/media";

interface TrailerStreamResponse {
  streams: Array<{ hlsUrl: string | null; id: number }>;
}

function ImageWithFallback({
  alt,
  className,
  src,
}: {
  alt: string;
  className: string;
  src: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={`${className} grid place-items-center bg-surface-elevated`}
      >
        <ImageIcon className="h-7 w-7 text-text-muted" />
      </div>
    );
  }
  return (
    <img
      alt={alt}
      className={className}
      loading="eager"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

function TrailerPlayer({
  hlsUrl,
  mp4Url,
  posterUrl,
  resolving,
  steamUrl,
  title,
  webmUrl,
}: {
  hlsUrl: string | null;
  mp4Url: string | null;
  posterUrl: string | null;
  resolving: boolean;
  steamUrl: string;
  title: string;
  webmUrl: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const directUrl = mp4Url ?? webmUrl;

  useEffect(() => {
    setFailed(false);
    const video = videoRef.current;
    if (!video || directUrl || !hlsUrl) {
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      return () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }
    if (!Hls.isSupported()) {
      setFailed(true);
      return;
    }

    const hls = new Hls({ enableWorker: true });
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        setFailed(true);
        hls.destroy();
      }
    });
    return () => {
      video.pause();
      hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [directUrl, hlsUrl]);

  if (resolving && !directUrl && !hlsUrl) {
    return (
      <div className="relative grid h-full min-h-[280px] w-full place-items-center overflow-hidden bg-[#0d0b0a]">
        {posterUrl && (
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-contain opacity-35"
            src={posterUrl}
          />
        )}
        <div className="relative flex items-center gap-2 text-sm text-white/75">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing trailer
        </div>
      </div>
    );
  }

  if (failed || (!directUrl && !hlsUrl)) {
    return (
      <div className="relative grid h-full min-h-[280px] w-full place-items-center overflow-hidden bg-[#0d0b0a]">
        {posterUrl && (
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-contain opacity-45"
            src={posterUrl}
          />
        )}
        <div className="relative max-w-sm px-6 text-center">
          <Film className="mx-auto h-7 w-7 text-white/65" />
          <p className="mt-3 text-sm font-semibold text-white">
            This trailer is hosted by Steam
          </p>
          <p className="mt-1 text-xs leading-5 text-white/60">
            PublisherIQ could not start the direct stream.
          </p>
          <a
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
            href={steamUrl}
            rel="noreferrer"
            target="_blank"
          >
            View on Steam <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <video
      aria-label={title}
      className="h-full max-h-[calc(100vh-190px)] w-full min-w-0 max-w-full bg-[#0d0b0a] object-contain"
      controls
      onError={() => setFailed(true)}
      playsInline
      poster={posterUrl ?? undefined}
      preload="metadata"
      ref={videoRef}
      src={directUrl ?? undefined}
    />
  );
}

export function OpportunityMediaLightbox({
  appid,
  initialIndex,
  items,
  onClose,
  steamUrl,
}: {
  appid: number;
  initialIndex: number;
  items: OpportunityGalleryItem[];
  onClose: () => void;
  steamUrl: string;
}) {
  const [activeIndex, setActiveIndex] = useState(
    Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0)),
  );
  const [resolvedStreams, setResolvedStreams] = useState<
    Record<number, string | null>
  >({});
  const [resolving, setResolving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const activeItem = items[activeIndex];

  const goTo = useCallback(
    (nextIndex: number) => {
      if (items.length === 0) return;
      setActiveIndex((nextIndex + items.length) % items.length);
    },
    [items.length],
  );
  const goPrevious = useCallback(
    () => goTo(activeIndex - 1),
    [activeIndex, goTo],
  );
  const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);

  const unresolvedTrailerIds = useMemo(
    () =>
      Array.from(
        new Set(
          items.flatMap((item) =>
            item.kind === "trailer" &&
            item.mediaId !== null &&
            !item.mp4Url &&
            !item.webmUrl &&
            !item.hlsUrl
              ? [item.mediaId]
              : [],
          ),
        ),
      ),
    [items],
  );

  useEffect(() => {
    if (unresolvedTrailerIds.length === 0) return;
    let cancelled = false;
    setResolving(true);
    void opportunityPost<TrailerStreamResponse>("resolve-trailer-streams", {
      appid,
      trailerIds: unresolvedTrailerIds,
    })
      .then((response) => {
        if (cancelled) return;
        setResolvedStreams(
          Object.fromEntries(
            response.streams.map((stream) => [stream.id, stream.hlsUrl]),
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedStreams(
          Object.fromEntries(unresolvedTrailerIds.map((id) => [id, null])),
        );
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appid, unresolvedTrailerIds]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [goNext, goPrevious, onClose]);

  if (!activeItem) return null;
  const activeHlsUrl =
    activeItem.kind === "trailer"
      ? (activeItem.hlsUrl ??
        (activeItem.mediaId === null
          ? null
          : (resolvedStreams[activeItem.mediaId] ?? null)))
      : null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-[#090807]/95 px-3 py-3 backdrop-blur-sm sm:px-5 sm:py-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-label="Steam media gallery"
        aria-modal="true"
        className="mx-auto grid h-full w-full min-w-0 max-w-[1500px] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-white/10 bg-[#12100f] shadow-2xl"
        ref={dialogRef}
        role="dialog"
      >
        <header className="flex min-w-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {activeItem.label}
            </p>
            <p aria-live="polite" className="mt-0.5 text-[11px] text-white/50">
              {activeItem.kind === "trailer"
                ? "Steam trailer"
                : activeItem.kind === "header"
                  ? "Steam header art"
                  : "Steam screenshot"}{" "}
              · {activeIndex + 1} of {items.length}
            </p>
          </div>
          <button
            aria-label="Close media gallery"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 text-white/70 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative grid min-h-0 min-w-0 place-items-center overflow-hidden">
          {activeItem.kind === "trailer" ? (
            <TrailerPlayer
              hlsUrl={activeHlsUrl}
              key={activeItem.id}
              mp4Url={activeItem.mp4Url}
              posterUrl={activeItem.previewUrl}
              resolving={
                resolving &&
                activeItem.mediaId !== null &&
                !activeItem.mp4Url &&
                !activeItem.webmUrl &&
                !activeHlsUrl
              }
              steamUrl={steamUrl}
              title={activeItem.label}
              webmUrl={activeItem.webmUrl}
            />
          ) : (
            <ImageWithFallback
              alt={activeItem.label}
              className="h-full max-h-[calc(100vh-190px)] w-full min-w-0 max-w-full object-contain"
              key={activeItem.id}
              src={activeItem.fullUrl}
            />
          )}
          {items.length > 1 && (
            <>
              <button
                aria-label="Previous media"
                className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12100f]/80 text-white/75 transition hover:bg-[#211d1b] hover:text-white sm:left-5"
                onClick={goPrevious}
                type="button"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                aria-label="Next media"
                className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-[#12100f]/80 text-white/75 transition hover:bg-[#211d1b] hover:text-white sm:right-5"
                onClick={goNext}
                type="button"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        <div className="border-t border-white/10 px-3 py-2.5 sm:px-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map((item, index) => (
              <button
                aria-label={`Open ${item.label}`}
                aria-pressed={index === activeIndex}
                className={`relative h-14 w-24 shrink-0 overflow-hidden rounded-md border transition sm:h-16 sm:w-28 ${
                  index === activeIndex
                    ? "border-accent-primary ring-1 ring-accent-primary/50"
                    : "border-white/10 opacity-65 hover:opacity-100"
                }`}
                key={item.id}
                onClick={() => goTo(index)}
                type="button"
              >
                {item.previewUrl ? (
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    src={item.previewUrl}
                  />
                ) : (
                  <span className="grid h-full place-items-center bg-white/5">
                    <Film className="h-4 w-4 text-white/50" />
                  </span>
                )}
                {item.kind === "trailer" && (
                  <span className="absolute inset-0 grid place-items-center bg-black/20">
                    <Film className="h-4 w-4 text-white" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
