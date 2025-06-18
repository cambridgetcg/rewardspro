// app/components/Icons.tsx
// Custom icon components with no external dependencies

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

export const Icons = {
  Edit: ({ size = 16, color = "currentColor", className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path 
        d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  Delete: ({ size = 16, color = "currentColor", className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <polyline 
        points="3 6 5 6 21 6" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  Plus: ({ size = 16, color = "currentColor", className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),

  Check: ({ size = 16, color = "currentColor", className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <polyline 
        points="20 6 9 17 4 12" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  X: ({ size = 16, color = "currentColor", className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),

  Circle: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="10" fill={fill || color} stroke={color} strokeWidth="2" />
    </svg>
  ),

  Star: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <polygon 
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  Crown: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <path 
        d="M12 6l-3 5.2L3 9l1.5 9h15L21 9l-6 2.2L12 6z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14" r="1" fill={color} />
    </svg>
  ),

  Diamond: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <path 
        d="M6 3h12l4 6-10 13L2 9z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path d="M10 9l2-6 2 6" stroke={color} strokeWidth="2" />
      <line x1="2" y1="9" x2="22" y2="9" stroke={color} strokeWidth="2" />
    </svg>
  ),

  Rocket: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <path 
        d="M9 11a4 4 0 1 0 6 0c0-2-3-6-3-6s-3 4-3 6z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M12 2c0 0 8 0 8 8s-3 8-3 8l-5-5-5 5s-3 0-3-8 8-8 8-8z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  Fire: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <path 
        d="M12 2c0 0-5 5-5 10a5 5 0 0 0 10 0c0-5-5-10-5-10z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M8.5 14.5c0 0-1.5-1.5-1.5-3a1.5 1.5 0 0 1 3 0c0 1.5-1.5 3-1.5 3z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  Heart: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <path 
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  Trophy: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <path 
        d="M8 2h8v9a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4V2z" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path d="M5 2v4a3 3 0 0 0 3 3h0M19 2v4a3 3 0 0 1-3 3h0" stroke={color} strokeWidth="2" />
      <line x1="12" y1="15" x2="12" y2="19" stroke={color} strokeWidth="2" />
      <path d="M8 19h8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),

  Lightning: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <polygon 
        points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" 
        stroke={color} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  Sparkles: ({ size = 16, color = "currentColor", className, fill }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} className={className}>
      <path d="M12 3v18M12 3l-3 3m3-3l3 3M12 21l-3-3m3 3l3-3" stroke={color} strokeWidth="2" />
      <path d="M3 12h18M3 12l3-3m-3 3l3 3M21 12l-3-3m3 3l-3 3" stroke={color} strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill={color} />
    </svg>
  ),

  ActiveStatus: ({ size = 16, className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="10" fill="#10b981" />
      <path 
        d="M8 12l2 2 4-4" 
        stroke="white" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),

  InactiveStatus: ({ size = 16, className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="10" fill="#ef4444" />
      <path 
        d="M15 9l-6 6M9 9l6 6" 
        stroke="white" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  ),
};

// Export tier icon mapping
export const TIER_ICON_MAP = {
  star: Icons.Star,
  crown: Icons.Crown,
  diamond: Icons.Diamond,
  rocket: Icons.Rocket,
  fire: Icons.Fire,
  heart: Icons.Heart,
  trophy: Icons.Trophy,
  lightning: Icons.Lightning,
  sparkles: Icons.Sparkles,
};

// Helper component to render tier icons
export function TierIcon({ 
  icon, 
  size = 24, 
  color, 
  fill 
}: { 
  icon: string; 
  size?: number; 
  color?: string; 
  fill?: string;
}) {
  const IconComponent = TIER_ICON_MAP[icon as keyof typeof TIER_ICON_MAP] || Icons.Star;
  return <IconComponent size={size} color={color} fill={fill} />;
}