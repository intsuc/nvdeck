import { Meter as MeterPrimitive } from "@base-ui/react/meter"

import { cn } from "@/lib/utils"

function Meter({ className, ...props }: MeterPrimitive.Root.Props) {
  return (
    <MeterPrimitive.Root
      data-slot="meter"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function MeterTrack({
  className,
  marker = false,
  ...props
}: MeterPrimitive.Track.Props & { marker?: boolean }) {
  return (
    <MeterPrimitive.Track
      data-slot="meter-track"
      className={cn(
        "relative h-2 w-full bg-muted",
        !marker && "overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

function MeterIndicator({
  className,
  marker = false,
  minimumVisible = false,
  ...props
}: MeterPrimitive.Indicator.Props & {
  marker?: boolean
  minimumVisible?: boolean
}) {
  return (
    <MeterPrimitive.Indicator
      data-slot="meter-indicator"
      className={cn(
        "h-full transition-[width] duration-300 motion-reduce:transition-none",
        marker && "relative",
        !marker && "bg-foreground",
        minimumVisible && "min-w-px",
        className,
      )}
      {...props}
    >
      {marker
        ? (
          <span
            aria-hidden="true"
            className="absolute top-1/2 right-0 h-4 w-0.5 translate-x-1/2 -translate-y-1/2 bg-foreground"
          />
        )
        : null}
    </MeterPrimitive.Indicator>
  )
}

export { Meter, MeterIndicator, MeterTrack }
