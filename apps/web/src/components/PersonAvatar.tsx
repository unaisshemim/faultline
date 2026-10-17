import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

// Stock portraits represent the seeded demo personas, not connected Teams users.
const demoPortraits: Record<string, string> = {
  arjun: '/avatars/arjun.jpg',
  leena: '/avatars/leena.jpg',
  nisha: '/avatars/nisha.jpg',
  maya: '/avatars/maya.jpg',
  dev: '/avatars/dev.jpg',
  kavya: '/avatars/kavya.jpg',
  rohan: '/avatars/rohan.jpg',
}

export function PersonAvatar({ id, name, initials, className }: { id?: string; name: string; initials: string; className?: string }) {
  const portrait = id ? demoPortraits[id] : undefined
  return <Avatar className={cn('person-avatar', className)}>
    {portrait && <AvatarImage src={portrait} alt={name} className="object-cover" />}
    <AvatarFallback>{initials}</AvatarFallback>
  </Avatar>
}
