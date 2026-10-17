import * as React from 'react'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

function HoverCard(props: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root {...props} />
}
function HoverCardTrigger(props: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger {...props} />
}
function HoverCardContent({ className, align = 'center', sideOffset = 4, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return <HoverCardPrimitive.Portal><HoverCardPrimitive.Content align={align} sideOffset={sideOffset} className={cn('z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none', className)} {...props} /></HoverCardPrimitive.Portal>
}
export { HoverCard, HoverCardTrigger, HoverCardContent }
