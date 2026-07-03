/**
 * Inline SVG icons. Win7 has no colour-emoji font, so anything meaningful is
 * drawn as SVG and every action also carries a text label — she reads well.
 */
interface IconProps {
  size?: number;
}

function svg(path: JSX.Element, size = 24, viewBox = '0 0 24 24') {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: '0 0 auto' }}
    >
      {path}
    </svg>
  );
}

export const IconBack = ({ size }: IconProps) => svg(<path d="M15 18l-6-6 6-6" />, size);
export const IconPlay = ({ size }: IconProps) => svg(<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />, size);
export const IconPause = ({ size }: IconProps) =>
  svg(
    <g fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4.4" height="16" rx="1.4" />
      <rect x="13.6" y="4" width="4.4" height="16" rx="1.4" />
    </g>,
    size
  );
export const IconFolder = ({ size }: IconProps) =>
  svg(<path d="M3 7a2 2 0 012-2h4l2 2.4h8A2 2 0 0121 9.4V17a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />, size);
export const IconSearch = ({ size }: IconProps) =>
  svg(
    <g>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.8-3.8" />
    </g>,
    size
  );
export const IconPlus = ({ size }: IconProps) => svg(<path d="M12 5v14M5 12h14" />, size);
export const IconShare = ({ size }: IconProps) =>
  svg(
    <g>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="17.5" cy="6" r="2.6" />
      <circle cx="17.5" cy="18" r="2.6" />
      <path d="M8.4 10.8l6.8-3.6M8.4 13.2l6.8 3.6" />
    </g>,
    size
  );
export const IconTrash = ({ size }: IconProps) =>
  svg(<path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m3 0l-.8 12a2 2 0 01-2 1.9H8.8a2 2 0 01-2-1.9L6 7" />, size);
export const IconPencil = ({ size }: IconProps) =>
  svg(<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" />, size);
export const IconMove = ({ size }: IconProps) =>
  svg(<path d="M3 7a2 2 0 012-2h4l2 2.4h8A2 2 0 0121 9.4V17a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM12 11v6M9.4 14.4L12 17l2.6-2.6" />, size);
export const IconDownload = ({ size }: IconProps) =>
  svg(<path d="M12 4v11m-5-5l5 5 5-5M5 20h14" />, size);
export const IconCheck = ({ size }: IconProps) => svg(<path d="M4.5 12.5l5 5L19.5 7" />, size);
export const IconX = ({ size }: IconProps) => svg(<path d="M6 6l12 12M18 6L6 18" />, size);
export const IconScissors = ({ size }: IconProps) =>
  svg(
    <g>
      <circle cx="6.5" cy="6.5" r="2.6" />
      <circle cx="6.5" cy="17.5" r="2.6" />
      <path d="M8.7 8.2L20 19M8.7 15.8L20 5" />
    </g>,
    size
  );
export const IconSpeed = ({ size }: IconProps) =>
  svg(<path d="M12 5a9 9 0 00-9 9c0 1.8.5 3.4 1.4 4.8h15.2A8.9 8.9 0 0021 14a9 9 0 00-9-9zm0 9l4.5-4.5" />, size);
export const IconBell = ({ size }: IconProps) =>
  svg(<path d="M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9zM10 19.6a2.2 2.2 0 004 0" />, size);
export const IconChevron = ({ size }: IconProps) => svg(<path d="M9 6l6 6-6 6" />, size);
export const IconFile = ({ size }: IconProps) =>
  svg(<path d="M6 3h8l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zm8 0v5h5" />, size);
export const IconCamera = ({ size }: IconProps) =>
  svg(<path d="M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm9 8.5A3.5 3.5 0 1012 9a3.5 3.5 0 000 7.5z" />, size);
export const IconNote = ({ size }: IconProps) =>
  svg(<path d="M9 18a3 3 0 11-3-3c.4 0 .7 0 1 .2V6l11-2v11a3 3 0 11-3-3c.4 0 .7 0 1 .2" />, size);
export const IconUpload = ({ size }: IconProps) =>
  svg(<path d="M12 16V5m-5 5l5-5 5 5M5 20h14" />, size);
export const IconMore = ({ size }: IconProps) =>
  svg(
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </g>,
    size
  );
