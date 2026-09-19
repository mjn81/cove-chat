import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    trackClassName?: string;
    thumbClassName?: string;
    rangeClassName?: string;
  }
>(({ className, trackClassName, thumbClassName, rangeClassName, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex touch-none select-none items-center",
      props.orientation === "vertical" ? "flex-col h-full w-1.5" : "w-full h-1.5",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className={cn(
      "relative grow overflow-hidden rounded-full bg-secondary",
      props.orientation === "vertical" ? "w-full h-full" : "h-full w-full",
      trackClassName
    )}>
      <SliderPrimitive.Range className={cn(
        "absolute bg-primary",
        props.orientation === "vertical" ? "w-full" : "h-full",
        rangeClassName
      )} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className={cn(
      "block h-3.5 w-3.5 rounded-full border border-primary/50 bg-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:scale-110 cursor-grab active:cursor-grabbing",
      thumbClassName
    )} />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
