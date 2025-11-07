

import React, { useRef, useEffect } from 'react';
import { TranscriptionEntry } from '../types';

interface TranscriptionPanelProps {
    transcriptions: TranscriptionEntry[];
    partialInput: string;
    partialOutput: string;
    isAiThinking: boolean;
    theme: 'jokes' | 'horror';
}

const TranscriptionPanel: React.FC<TranscriptionPanelProps> = ({ transcriptions, partialInput, partialOutput, isAiThinking, theme }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [transcriptions, partialInput, partialOutput, isAiThinking]);

    const userColors = theme === 'jokes' 
        ? 'text-indigo-400 bg-indigo-500' 
        : 'text-rose-400 bg-rose-900';
    const aiColors = theme === 'jokes'
        ? 'text-teal-400 bg-slate-700'
        : 'text-cyan-400 bg-slate-700';

    return (
        <div 
            ref={scrollRef} 
            className="w-full h-full bg-slate-800/50 rounded-lg p-4 md:p-6 overflow-y-auto border border-slate-700 shadow-inner"
        >
            <div className="space-y-4">
                {/* Render completed transcriptions */}
                {transcriptions.map((entry, index) => (
                    <div key={index} className={`flex flex-col ${entry.speaker === 'You' ? 'items-end' : 'items-start'}`}>
                        <div className={`text-sm font-bold mb-1 ${entry.speaker === 'You' ? userColors.split(' ')[0] : aiColors.split(' ')[0]}`}>
                            {entry.speaker}
                        </div>
                        <div className={`max-w-xs md:max-w-md lg:max-w-lg rounded-xl px-4 py-2 ${
                            entry.speaker === 'You' 
                                ? `${userColors.split(' ')[1]} text-white rounded-br-none` 
                                : `${aiColors.split(' ')[1]} text-slate-200 rounded-bl-none animate-[fade-in-up_0.5s_ease-out]` // Animate final AI messages
                        }`}>
                            <p className="text-sm md:text-base">{entry.text}</p>
                        </div>
                    </div>
                ))}
                
                {/* Render partial user input with listening indicator */}
                {partialInput && (
                     <div className="flex flex-col items-end animate-pulse">
                        <div className={`text-sm font-bold mb-1 ${userColors.split(' ')[0]}`}>
                            You (Listening...)
                        </div>
                        <div className={`max-w-xs md:max-w-md lg:max-w-lg rounded-xl px-4 py-2 ${userColors.split(' ')[1]} text-white rounded-br-none`}>
                            <p className="text-sm md:text-base">{partialInput}</p>
                        </div>
                    </div>
                )}
                
                {/* Render partial AI output */}
                {partialOutput && (
                    <div className="flex flex-col items-start">
                        <div className={`text-sm font-bold mb-1 ${aiColors.split(' ')[0]}`}>
                           AI
                        </div>
                        <div className={`max-w-xs md:max-w-md lg:max-w-lg rounded-xl px-4 py-2 ${aiColors.split(' ')[1]} text-slate-200 rounded-bl-none`}>
                            <p className="text-sm md:text-base">{partialOutput}</p>
                        </div>
                    </div>
                )}

                {/* Render AI thinking indicator */}
                {isAiThinking && (
                     <div className="flex flex-col items-start">
                        <div className={`text-sm font-bold mb-1 ${aiColors.split(' ')[0]}`}>
                           AI
                        </div>
                        <div className={`max-w-xs md:max-w-md lg:max-w-lg rounded-xl px-4 py-2 ${aiColors.split(' ')[1]} text-slate-200 rounded-bl-none`}>
                           <div className="flex space-x-1.5 py-1">
                                <span className={`w-2 h-2 ${theme === 'jokes' ? 'bg-teal-400' : 'bg-cyan-400'} rounded-full animate-pulse`}></span>
                                <span className={`w-2 h-2 ${theme === 'jokes' ? 'bg-teal-400' : 'bg-cyan-400'} rounded-full animate-pulse !animation-delay-150`}></span>
                                <span className={`w-2 h-2 ${theme === 'jokes' ? 'bg-teal-400' : 'bg-cyan-400'} rounded-full animate-pulse !animation-delay-300`}></span>
                           </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TranscriptionPanel;