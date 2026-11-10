import { Award, Shield, Star, Zap, Crown } from 'lucide-react';

export const AVAILABLE_ICONS = [
    { name: 'award', icon: Award },
    { name: 'shield', icon: Shield },
    { name: 'star', icon: Star },
    { name: 'zap', icon: Zap },
    { name: 'crown', icon: Crown },
];

export const AVAILABLE_COLORS = [
    { value: 'blue', label: 'Blue', class: 'text-blue-400 bg-blue-500/20 border-blue-500/30' },
    { value: 'green', label: 'Green', class: 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30' },
    { value: 'yellow', label: 'Yellow', class: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30' },
    { value: 'purple', label: 'Purple', class: 'text-purple-400 bg-purple-500/20 border-purple-500/30' },
    { value: 'amber', label: 'Amber', class: 'text-amber-400 bg-amber-500/20 border-amber-500/30' },
    { value: 'red', label: 'Red', class: 'text-red-400 bg-red-500/20 border-red-500/30' },
];
