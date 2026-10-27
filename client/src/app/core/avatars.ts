import { Avatar } from './models';

// Avatar choices. Keep in sync with AVATAR_IMAGES in src/rooms.js.
// Character pictures (/avatars/<id>.webp), grouped by series for the picker.
export const AVATAR_CHARACTERS: [string, [string, string][]][] = [
  ['One Piece', [['luffy', 'Luffy'], ['zoro', 'Zoro'], ['nami', 'Nami'], ['usopp', 'Usopp'], ['sanji', 'Sanji'],
    ['chopper', 'Tony Tony Chopper'], ['robin', 'Robin']]],
  ['Naruto', [['naruto', 'Naruto'], ['sasuke', 'Sasuke'], ['sakura', 'Sakura'], ['kakashi', 'Kakashi'], ['hinata', 'Hinata'],
    ['jiraiya', 'Jiraiya'], ['tsunade', 'Tsunade']]],
  ['Attack on Titan', [['eren', 'Eren'], ['mikasa', 'Mikasa'], ['armin', 'Armin'], ['levi', 'Levi'], ['hange', 'Hange'],
    ['erwin', 'Erwin'], ['sasha', 'Sasha']]],
  ['My Hero Academia', [['deku', 'Deku'], ['uraraka', 'Uraraka'], ['bakugo', 'Bakugo'], ['todoroki', 'Todoroki'], ['tsuyu', 'Tsuyu'],
    ['momo', 'Momo'], ['all-might', 'All Might']]],
  ['Jackie Chan Adventures', [['jackie', 'Jackie'], ['jade', 'Jade'], ['uncle', 'Uncle'], ['tohru', 'Tohru'], ['viper', 'Viper'],
    ['el-toro', 'El Toro Fuerte'], ['captain-black', 'Captain Black']]],
];
export const AVATAR_IMAGES: string[] = AVATAR_CHARACTERS.flatMap(([, list]) => list.map(([id]) => id));
export const avatarImageUrl = (id: string): string => `avatars/${id}.webp`;

// Every avatar sits on the same UNO-red background; only the character or initials differ.
export const AVATAR_BACKGROUND = 'radial-gradient(circle at 35% 30%, #ff5a4f 0%, #e2202f 45%, #9e0f19 100%)';

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w[0] ?? ''));
  return (words.map((w) => w[0]).join('').slice(0, 2) || name.slice(0, 1)).toUpperCase();
}

export interface AvatarLook {
  text: string;
  image: string | null;
  background: string;
}

/** What to draw for an avatar: the chosen character picture, or initials, on the shared background. */
export function avatarLook(name: string, avatar: Avatar | null | undefined): AvatarLook {
  const image = avatar?.image && AVATAR_IMAGES.includes(avatar.image) ? avatar.image : null;
  return { text: image ? '' : initials(name), image, background: AVATAR_BACKGROUND };
}
