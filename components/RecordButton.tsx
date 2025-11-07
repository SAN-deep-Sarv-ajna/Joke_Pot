import React from 'react';

const CallIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.02.74-.25 1.02l-2.2 2.2z" />
    </svg>
);

const EndCallIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 rotate-135" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.02.74-.25 1.02l-2.2 2.2z" />
    </svg>
);

interface CallButtonProps {
    isCallActive: boolean;
    onClick: () => void;
    disabled?: boolean;
    theme: 'jokes' | 'horror';
}

const CallButton: React.FC<CallButtonProps> = ({ isCallActive, onClick, disabled, theme }) => {
    const themeClasses = theme === 'jokes' 
        ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500 animate-pulse'
        : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500 animate-pulse';
    
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center justify-center h-20 w-20 rounded-full shadow-lg transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed ${
                isCallActive
                    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                    : themeClasses
            }`}
        >
            {isCallActive ? <EndCallIcon /> : <CallIcon />}
        </button>
    );
};

export default CallButton;
