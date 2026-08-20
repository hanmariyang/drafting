/**
 * 초안이(Choani) — Drafting 캐릭터 정본. design/CHARACTER.md 를 따른다.
 * 외곽선 B=3.2 (2026-08-20 확정), 3색(잉크·제안 그린·종이) 고정.
 * 크기 사다리: <24px = 얼굴만(micro) · <48px = 얼굴+도트(face) · 이상 = 풀 포즈.
 * 모션은 styles.css 의 .ch-* 키프레임 — animate=false 로 정적 렌더.
 */

export type ChoaniPose =
  | 'base'
  | 'greet'
  | 'fetch'
  | 'write'
  | 'think'
  | 'wait'
  | 'done'
  | 'error';

const INK = 'var(--ink)';
const SUG = 'var(--sug)';
const PAPER = 'var(--paper)';

// B(3.2) 비례 두께
const W = 3.2; // 몸
const W_ALT = 2.9; // 접힘·구김 몸
const MOUTH = 2.1;
const FLAT = 2.0;
const LINE = 2.7;
const DET = 2.3; // 눈웃음·X눈

const BODY = (
  <rect x="31" y="16" width="58" height="88" rx="15" fill={PAPER} stroke={INK} strokeWidth={W} />
);
const EYES = (
  <>
    <circle className="ch-eye" cx="50" cy="45" r="3.6" fill={INK} />
    <circle className="ch-eye" cx="70" cy="45" r="3.6" fill={INK} />
  </>
);
const SMILE = (
  <path d="M55 54 q5 4.5 10 0" stroke={INK} strokeWidth={MOUTH} fill="none" strokeLinecap="round" />
);
const DOT = <circle cx="47" cy="76" r="5.4" fill={SUG} />;
const MARK = (
  <>
    {DOT}
    <line x1="57" y1="76" x2="75" y2="76" stroke={INK} strokeWidth={LINE} strokeLinecap="round" />
  </>
);
const HAPPY_EYES = (
  <>
    <path d="M46 44 q4 -4.5 8 0" stroke={INK} strokeWidth={DET} fill="none" strokeLinecap="round" />
    <path d="M66 44 q4 -4.5 8 0" stroke={INK} strokeWidth={DET} fill="none" strokeLinecap="round" />
  </>
);
const TAG = (
  <g className="ch-tag">
    <g transform="rotate(-9 60 60)">
      <rect x="46" y="52" width="28" height="15" rx="5" fill={SUG} />
      <line x1="52" y1="59.5" x2="68" y2="59.5" stroke={PAPER} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  </g>
);

function fullPose(pose: ChoaniPose) {
  switch (pose) {
    case 'base':
      return { tilt: -2, body: <>{BODY}{EYES}{SMILE}{MARK}</> };
    case 'greet':
      return {
        tilt: -5,
        body: (
          <g className="ch-rock">
            <path
              d="M46 16 h27 l16 16 v57 a15 15 0 0 1 -15 15 h-28 a15 15 0 0 1 -15 -15 v-58 a15 15 0 0 1 15 -15 z"
              fill={PAPER} stroke={INK} strokeWidth={W} strokeLinejoin="round"
            />
            <path d="M73 16 v16 h16 z" fill="var(--sug-bg)" stroke={INK} strokeWidth={W_ALT} strokeLinejoin="round" />
            {EYES}
            <path d="M53 55 q7 6.5 14 0" stroke={INK} strokeWidth={MOUTH} fill="none" strokeLinecap="round" />
            {MARK}
          </g>
        ),
      };
    case 'fetch':
      return { tilt: -2, body: <>{BODY}{HAPPY_EYES}{TAG}</> };
    case 'write':
      return {
        tilt: 3,
        body: (
          <>
            {BODY}
            <circle className="ch-eye" cx="50" cy="48" r="3.2" fill={INK} />
            <circle className="ch-eye" cx="70" cy="48" r="3.2" fill={INK} />
            <line x1="57" y1="56" x2="66" y2="56" stroke={INK} strokeWidth={FLAT} strokeLinecap="round" />
            <line className="ch-draw" pathLength={1} x1="45" y1="78" x2="63" y2="78" stroke={INK} strokeWidth={LINE} strokeLinecap="round" />
            <g className="ch-pen">
              <g transform="rotate(38 66 78)">
                <rect x="63" y="56" width="7" height="19" rx="2" fill={INK} />
                <path d="M63 78 l3.5 7 l3.5 -7 z" fill={SUG} />
              </g>
            </g>
          </>
        ),
      };
    case 'think':
      return {
        tilt: -2,
        body: (
          <>
            {BODY}
            <circle className="ch-eye" cx="49" cy="41" r="3.6" fill={INK} />
            <circle className="ch-eye" cx="69" cy="41" r="3.6" fill={INK} />
            <line x1="56" y1="55" x2="64" y2="55" stroke={INK} strokeWidth={FLAT} strokeLinecap="round" />
            {MARK}
            <circle className="ch-td" cx="95" cy="26" r="3" fill={INK} />
            <circle className="ch-td ch-td2" cx="104" cy="19" r="3.6" fill={INK} />
            <circle className="ch-td ch-td3" cx="112" cy="11" r="4.2" fill={INK} />
          </>
        ),
      };
    case 'wait':
      return {
        tilt: 6,
        body: (
          <g className="ch-bob">
            {BODY}
            <path d="M46 46 q4 3.5 8 0" stroke={INK} strokeWidth={MOUTH} fill="none" strokeLinecap="round" />
            <path d="M66 46 q4 3.5 8 0" stroke={INK} strokeWidth={MOUTH} fill="none" strokeLinecap="round" />
            <line x1="56" y1="56" x2="64" y2="56" stroke={INK} strokeWidth={FLAT} strokeLinecap="round" />
            {MARK}
          </g>
        ),
      };
    case 'done':
      return {
        tilt: 0,
        body: (
          <>
            {BODY}
            {HAPPY_EYES}
            <path d="M53 54 q7 6 14 0" stroke={INK} strokeWidth={MOUTH} fill="none" strokeLinecap="round" />
            {MARK}
            <path className="ch-sp" d="M100 22 l2.4 6 l6 2.4 l-6 2.4 l-2.4 6 l-2.4 -6 l-6 -2.4 l6 -2.4 z" fill={SUG} />
            <path className="ch-sp ch-sp2" d="M108 44 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 z" fill={SUG} />
          </>
        ),
      };
    case 'error':
      return {
        tilt: 0,
        body: (
          <g className="ch-shiver">
            <path
              d="M36 24 l14 -7 l11 6 l13 -5 l12 9 l-4 14 l5 12 l-6 13 l4 13 l-11 12 l-13 -4 l-12 6 l-11 -9 l3 -13 l-5 -12 l6 -12 l-6 -11 z"
              fill={PAPER} stroke={INK} strokeWidth={W_ALT} strokeLinejoin="round"
            />
            <path d="M50 40 l18 14 M52 66 l14 -8" stroke={INK} strokeWidth="1.6" opacity=".25" />
            <path d="M46 46 l7 7 M53 46 l-7 7" stroke={INK} strokeWidth={DET} strokeLinecap="round" />
            <path d="M66 48 l7 7 M73 48 l-7 7" stroke={INK} strokeWidth={DET} strokeLinecap="round" />
            <path d="M56 68 q5 -3.5 10 0" stroke={INK} strokeWidth={MOUTH} fill="none" strokeLinecap="round" />
          </g>
        ),
      };
  }
}

/** 소형: 얼굴+도트(face) / 얼굴만(micro). fetch 는 쪽지가 정체성이라 유지. */
function smallPose(pose: ChoaniPose, micro: boolean) {
  const eyes = pose === 'fetch' ? HAPPY_EYES : EYES;
  const extra =
    pose === 'fetch' ? TAG : micro ? SMILE : (
      <>
        {SMILE}
        <circle cx="60" cy="76" r="5.4" fill={SUG} />
      </>
    );
  return { tilt: -2, body: <>{BODY}{eyes}{extra}</> };
}

interface Props {
  pose?: ChoaniPose;
  size?: number;
  /** false 면 모든 모션 정지 (제안 카드 아바타 등 강도 사다리 최하단) */
  animate?: boolean;
  className?: string;
}

export function Choani({ pose = 'base', size = 64, animate = true, className = '' }: Props) {
  const spec =
    size < 48 && pose !== 'error' ? smallPose(pose, size < 24) : fullPose(pose);
  return (
    <svg
      className={`ch ${animate ? '' : 'ch-static'} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="초안이"
    >
      <g transform={`rotate(${spec.tilt} 60 60)`}>{spec.body}</g>
    </svg>
  );
}
