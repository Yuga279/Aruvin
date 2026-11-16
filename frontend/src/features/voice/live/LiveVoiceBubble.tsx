/**
 * ============================================================================
 * FILE: LiveVoiceBubble.tsx
 * LOCATION: frontend/src/features/voice/live/LiveVoiceBubble.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Responsive audio waveform visualizer for live duplex voice mode.
 *
 * ROLE IN PROJECT:
 *    Renders a neutral dotted-line baseline that dynamically emerges and fluctuates
 *    into audio waveform waves as the user speaks (and during agent response),
 *    returning smoothly to the neutral dotted line when silent.
 *
 * KEY COMPONENTS:
 *    - PEAK_BARS: Target wave shape specification for speech fluctuation.
 *    - LiveVoiceBubble: Responsive SVG waveform component with 60fps smoothing.
 * ============================================================================
 */

import { useEffect, useRef } from 'react';
import type { LiveVoiceState } from '../state/live-voice-reducer.ts';

const NEUTRAL_HEIGHT = 8;
const NUM_BARS = 23;

const PEAK_BARS = [
  8, 8, 8, 8, 14, 32, 52, 24, 15, 36, 60, 88, 60, 36, 15, 24, 52, 32, 14, 8, 8, 8, 8,
] as const;

const SENSITIVITIES = [
  0.1, 0.1, 0.15, 0.2,
  0.5, 0.8, 1.0, 0.7, 0.6, 0.9, 1.1, 1.25, 1.1, 0.9, 0.6, 0.7, 1.0, 0.8, 0.5,
  0.2, 0.15, 0.1, 0.1,
] as const;

export type LiveVoiceBubbleProps = {
  view: LiveVoiceState;
  getVolume?: () => number;
};

export function LiveVoiceBubble({ view, getVolume }: LiveVoiceBubbleProps) {
  const paused = view.resumeRequired;
  const barRefs = useRef<(SVGRectElement | null)[]>([]);
  const heightsRef = useRef<number[]>(Array(NUM_BARS).fill(NEUTRAL_HEIGHT));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    let rafId: number;
    let smoothVol = 0;
    let startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const rawVol = getVolume ? getVolume() : 0;

      // Fast attack, smooth decay
      if (rawVol > smoothVol) {
        smoothVol += (rawVol - smoothVol) * 0.45;
      } else {
        smoothVol += (rawVol - smoothVol) * 0.18;
      }

      const heights = heightsRef.current;
      const isSpeakingAgent = view.agent === 'speaking';
      const isThinking = view.agent === 'thinking';
      const isUserSpeaking = smoothVol > 0.02 && !paused && view.input === 'listening';

      for (let i = 0; i < NUM_BARS; i++) {
        let target: number = NEUTRAL_HEIGHT;
        const peakDiff = PEAK_BARS[i] - NEUTRAL_HEIGHT;

        if (isSpeakingAgent) {
          const speechFactor = 0.85 + Math.sin(elapsed * 0.012) * 0.15;
          const wave = Math.sin(elapsed * 0.014 + i * 0.45) * 0.35 + Math.cos(elapsed * 0.022 - i * 0.3) * 0.2;
          target = Math.max(NEUTRAL_HEIGHT, Math.min(94, NEUTRAL_HEIGHT + peakDiff * speechFactor * (1 + wave)));
        } else if (isThinking) {
          const shimmer = Math.max(0, Math.sin(elapsed * 0.008 + i * 0.6)) * 8;
          target = NEUTRAL_HEIGHT + shimmer;
        } else if (paused) {
          target = NEUTRAL_HEIGHT;
        } else if (isUserSpeaking) {
          const voiceFactor = Math.min(1.4, smoothVol * 2.2);
          const harmonic = Math.sin(elapsed * 0.018 + i * 0.5) * 0.3 + Math.cos(elapsed * 0.026 - i * 0.35) * 0.18;
          const sensitivity = SENSITIVITIES[i] ?? 0.8;
          target = Math.max(NEUTRAL_HEIGHT, Math.min(96, NEUTRAL_HEIGHT + peakDiff * voiceFactor * sensitivity * (1 + harmonic)));
        } else {
          // Neutral resting dotted line
          target = NEUTRAL_HEIGHT;
        }

        // Smoothly interpolate towards target
        heights[i] += (target - heights[i]) * 0.35;
        const rect = barRefs.current[i];
        if (rect) {
          rect.setAttribute('height', heights[i].toFixed(1));
          rect.setAttribute('y', (50 - heights[i] / 2).toFixed(1));
        }
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [view.phase, view.agent, view.input, paused, getVolume]);

  return (
    <div
      className="aurvin-live-bubble"
      aria-hidden="true"
      data-phase={view.phase}
      data-agent={view.agent}
      data-input={view.input}
      data-connection={view.connection}
      data-paused={paused}
    >
      <div className="aurvin-live-bubble-core">
        <svg
          viewBox="0 0 420 100"
          className="aurvin-live-waveform"
          focusable="false"
        >
          {Array.from({ length: NUM_BARS }).map((_, i) => {
            const cx = 12 + i * 18;
            const x = cx - 4;
            const y = 50 - NEUTRAL_HEIGHT / 2;
            return (
              <rect
                key={i}
                ref={el => { barRefs.current[i] = el; }}
                className={`aurvin-live-bar aurvin-live-bar-${i + 1}`}
                x={x}
                y={y}
                width={8}
                height={NEUTRAL_HEIGHT}
                rx={4}
                ry={4}
                fill="#ffffff"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
