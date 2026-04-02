const fs = require('fs');
const file = 'frontend/src/components/DetailTabs.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    "import { Users, Mic, Loader, Play, Calendar, Search } from 'lucide-react';",
    "import { Users, Mic, Loader, Play, Calendar, Search, Star } from 'lucide-react';"
);

const toReplace = `                <div className="min-w-0">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Status Distribution
                    </h2>
                    <StatusDistribution anime={anime} />
                </div>`;

const replacement = `                <div className="min-w-0 flex flex-col gap-8">
                    <div>
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                            Status Distribution
                        </h2>
                        <StatusDistribution anime={anime} />
                    </div>
                    
                    <div>
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                            Average Score
                        </h2>
                        <div className="bg-dark-100/50 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
                            <Star 
                                className="w-5 h-5 mb-2" 
                                style={{ color: accentColor || '#75698d' }} 
                            />
                            <p className="text-2xl font-black text-white">
                                {anime?.rating || 'N/A'}
                                {anime?.rating ? <span className="text-sm font-normal text-gray-400 ml-1">/ 10</span> : ''}
                            </p>
                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.12em]">Average Score</p>
                        </div>
                    </div>
                </div>`;

content = content.replace(toReplace, replacement);

fs.writeFileSync(file, content);
