import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react"
import type { CSSProperties } from "react"
import { Toaster as Sonner } from "sonner"

import { useAppStore } from "@/store/app.slice"

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * App-wide toast host. Mount once (see `app/` providers) and trigger toasts
 * with `toast` from `sonner`. Follows the app's own light/dark setting rather
 * than the OS preference, and uses theme tokens only.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppStore((s) => s.theme)

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // Sonner's own defaults are fixed light/dark colours; point them at the tokens so a custom theme reaches
      // everything a toast draws (background, text, border).
      style={
        {
          '--normal-bg': 'hsl(var(--popover))',
          '--normal-text': 'hsl(var(--popover-foreground))',
          '--normal-border': 'hsl(var(--border))',
        } as CSSProperties
      }
      icons={{
        success: <CircleCheck className="h-4 w-4 text-success" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4 text-warning" />,
        error: <OctagonX className="h-4 w-4 text-destructive" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-none",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
