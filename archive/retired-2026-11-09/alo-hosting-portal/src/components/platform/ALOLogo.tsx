export function ALOLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="alo-grad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0A5CFF" />
          <stop offset="1" stopColor="#E8501A" />
        </linearGradient>
        <linearGradient id="alo-grad-accent" x1="48" y1="85" x2="72" y2="85" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#60A5FA" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="url(#alo-grad)" />
      <path
        d="M34 82L60 32L86 82H76L70 70H50L44 82H34ZM54 62H66L60 48L54 62Z"
        fill="white" fillRule="evenodd"
      />
      <rect x="48" y="85" width="24" height="4" rx="2" fill="url(#alo-grad-accent)" />
      <circle cx="30" cy="38" r="3" fill="white" opacity="0.5" />
      <circle cx="90" cy="38" r="3" fill="#3B82F6" opacity="0.7" />
      <circle cx="92" cy="75" r="2.5" fill="#3B82F6" opacity="0.5" />
      <circle cx="28" cy="72" r="2.5" fill="white" opacity="0.35" />
    </svg>
  )
}

export function ALOLogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="alo-mark-grad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0A5CFF" />
          <stop offset="1" stopColor="#E8501A" />
        </linearGradient>
        <linearGradient id="alo-mark-accent" x1="48" y1="85" x2="72" y2="85" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#60A5FA" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="url(#alo-mark-grad)" />
      <path
        d="M34 82L60 32L86 82H76L70 70H50L44 82H34ZM54 62H66L60 48L54 62Z"
        fill="white" fillRule="evenodd"
      />
      <rect x="48" y="85" width="24" height="4" rx="2" fill="url(#alo-mark-accent)" />
      <circle cx="30" cy="38" r="3" fill="white" opacity="0.5" />
      <circle cx="90" cy="38" r="3" fill="#3B82F6" opacity="0.7" />
      <circle cx="92" cy="75" r="2.5" fill="#3B82F6" opacity="0.5" />
      <circle cx="28" cy="72" r="2.5" fill="white" opacity="0.35" />
    </svg>
  )
}

export function ALOTextLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <ALOLogoMark className="h-8 w-8" />
      <div className="flex flex-col">
        <span className="text-sm font-bold leading-tight text-white">
          ALO <span className="text-[#3B82F6]">Labs</span>
        </span>
        <span className="text-[10px] leading-tight text-gray-400">Cloud Platform</span>
      </div>
    </div>
  )
}