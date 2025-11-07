
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, FunctionDeclaration, Type } from '@google/genai';
import { TranscriptionEntry } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio';
import CallButton from './components/RecordButton';
import TranscriptionPanel from './components/TranscriptionPanel';

type AppCategory = 'Hindi' | 'Bihari Hindi' | 'Santa Banta' | 'Husband-Wife' | 'Hindi Horror' | 'Bihari Horror';
type CallState = 'idle' | 'calling' | 'active' | 'ended';
type AppTheme = 'jokes' | 'horror';

const CATEGORIES: AppCategory[] = ['Hindi', 'Bihari Hindi', 'Santa Banta', 'Husband-Wife', 'Hindi Horror', 'Bihari Horror'];

// --- Tool Definition for Sound Effects ---
const playSoundEffectFunctionDeclaration: FunctionDeclaration = {
    name: 'playSoundEffect',
    description: 'Plays a sound effect to enhance the horror story atmosphere. Use this for dramatic moments or continuous background atmosphere.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            soundName: {
                type: Type.STRING,
                description: "The name of the sound effect to play. Available sounds: 'creak', 'whisper', 'heartbeat', 'wind', 'thump'.",
            },
            loop: {
                type: Type.BOOLEAN,
                description: "Whether the sound should loop continuously in the background. Defaults to false. Use 'true' for atmospheric sounds like 'wind' or 'heartbeat'."
            }
        },
        required: ['soundName'],
    },
};

const setAmbianceVolumeFunctionDeclaration: FunctionDeclaration = {
    name: 'setAmbianceVolume',
    description: 'Adjusts the volume of the continuous background sound effect to match the story\'s intensity. Use this to build suspense or create a jump scare.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            volume: {
                type: Type.NUMBER,
                description: "The desired volume level from 0.0 (silent) to 1.0 (max). For example: 0.1 for a subtle atmosphere, 0.3 for rising tension, 0.6 for a climactic moment.",
            },
        },
        required: ['volume'],
    },
};


// --- Helper Components ---

const CallTimer: React.FC<{ startTime: number }> = ({ startTime }) => {
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        const calculateElapsed = () => {
            setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
        };
        const intervalId = setInterval(calculateElapsed, 1000);
        return () => clearInterval(intervalId);
    }, [startTime]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    return <p className="text-slate-400 text-lg">{formatTime(elapsedSeconds)}</p>;
};

const AIAvatar: React.FC<{theme: AppTheme}> = ({ theme }) => {
    const jokeAvatar = "😂";
    const horrorAvatar = "🌙";
    const jokeBg = "bg-gradient-to-br from-amber-400 to-orange-600";
    const horrorBg = "bg-gradient-to-br from-indigo-800 to-rose-900";

    return (
        <div className={`w-32 h-32 ${theme === 'jokes' ? jokeBg : horrorBg} rounded-full flex items-center justify-center shadow-lg mb-4`}>
            <span className="text-6xl font-bold text-slate-900 drop-shadow-lg">{theme === 'jokes' ? jokeAvatar : horrorAvatar}</span>
        </div>
    );
}


// --- Main App Component ---

const App: React.FC = () => {
    const [callState, setCallState] = useState<CallState>('idle');
    const [category, setCategory] = useState<AppCategory>('Hindi');
    const [theme, setTheme] = useState<AppTheme>('jokes');
    
    useEffect(() => {
        setTheme(category.includes('Horror') ? 'horror' : 'jokes');
    }, [category]);

    const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
    const [isAiThinking, setIsAiThinking] = useState(false);
    
    const [micError, setMicError] = useState<string | null>(null);
    const [volume, setVolume] = useState(1.0);

    const currentInputRef = useRef('');
    const currentOutputRef = useRef('');
    const [partialInput, setPartialInput] = useState('');
    const [partialOutput, setPartialOutput] = useState('');

    const [callStartTime, setCallStartTime] = useState<number | null>(null);
    const [callDuration, setCallDuration] = useState<number>(0);

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const masterGainRef = useRef<GainNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const ambientSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const ambientGainRef = useRef<GainNode | null>(null);
    const isEndingRef = useRef(false); // Lock to prevent error race conditions


    const playSound = useCallback((type: 'connect' | 'disconnect' | 'pop' | 'creak' | 'whisper' | 'heartbeat' | 'wind' | 'thump', loop: boolean = false) => {
        if (!outputAudioContextRef.current || !masterGainRef.current) return;
        const audioCtx = outputAudioContextRef.current;
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        if (loop && ambientSourceRef.current) {
            try { ambientSourceRef.current.stop(); } catch(e) {}
            ambientSourceRef.current = null;
            ambientGainRef.current = null;
        }

        const now = audioCtx.currentTime;
        let mainNode: AudioNode;
        let sourceToStore: AudioBufferSourceNode | null = null;
        let oneShot = true;

        const gainNode = audioCtx.createGain();

        // One-shot effects
        if (type === 'connect' || type === 'disconnect' || type === 'pop' || type === 'creak' || type === 'thump') {
            const oscillator = audioCtx.createOscillator();
            mainNode = oscillator;
            switch (type) {
                case 'connect':
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(600, now);
                    gainNode.gain.setValueAtTime(0.1, now);
                    oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.1);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
                    break;
                case 'disconnect':
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(800, now);
                    gainNode.gain.setValueAtTime(0.1, now);
                    oscillator.frequency.exponentialRampToValueAtTime(600, now + 0.1);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
                    break;
                case 'pop':
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(440, now);
                    gainNode.gain.setValueAtTime(0.05, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
                    break;
                case 'creak':
                    oscillator.type = 'sawtooth';
                    oscillator.frequency.setValueAtTime(200, now);
                    gainNode.gain.setValueAtTime(0.1, now);
                    oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.5);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
                    break;
                case 'thump':
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(80, now);
                    gainNode.gain.setValueAtTime(0.3, now);
                    oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.1);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
                    break;
            }
             oscillator.start(now);
             oscillator.stop(now + 1);
        } else { // Buffer-based sounds
            oneShot = false;
            const bufferSize = audioCtx.sampleRate * 2; // 2 seconds buffer for looping
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            sourceToStore = source;
            mainNode = source;

            switch (type) {
                 case 'whisper': // Whisper remains one-shot but uses a buffer
                    oneShot = true;
                     for (let i = 0; i < buffer.length; i++) {
                        data[i] = Math.random() * 2 - 1;
                    }
                    const filter = audioCtx.createBiquadFilter();
                    filter.type = 'bandpass';
                    filter.frequency.value = 4000;
                    filter.Q.value = 2;
                    source.connect(filter);
                    mainNode = filter;
                    gainNode.gain.setValueAtTime(0.02, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1);
                    break;
                case 'wind':
                     for (let i = 0; i < buffer.length; i++) {
                        data[i] = Math.random() * 2 - 1; // White noise
                    }
                    const windFilter = audioCtx.createBiquadFilter();
                    windFilter.type = 'lowpass';
                    windFilter.frequency.value = 700;
                    windFilter.Q.value = 10;
                    source.connect(windFilter);
                    mainNode = windFilter;
                    gainNode.gain.setValueAtTime(0.15, now);
                    break;
                case 'heartbeat':
                    const thumpDuration = 0.05;
                    const thumpFreq = 60;
                    for (let i = 0; i < audioCtx.sampleRate * thumpDuration; i++) {
                        // Thump 1
                        data[i] = Math.sin(i / audioCtx.sampleRate * Math.PI * 2 * thumpFreq) * Math.exp(-i / (audioCtx.sampleRate * thumpDuration) * 5);
                        // Thump 2
                        const i2 = i + Math.floor(audioCtx.sampleRate * 0.3);
                        data[i2] = Math.sin(i / audioCtx.sampleRate * Math.PI * 2 * thumpFreq) * Math.exp(-i / (audioCtx.sampleRate * thumpDuration) * 5) * 0.8;
                    }
                    gainNode.gain.setValueAtTime(0.2, now);
                    break;
            }
             source.start(now);
             if (oneShot) {
                source.stop(now + 1);
             }
        }
        
        mainNode.connect(gainNode);
        gainNode.connect(masterGainRef.current);
        
        if (loop && sourceToStore) {
            sourceToStore.loop = true;
            ambientSourceRef.current = sourceToStore;
            ambientGainRef.current = gainNode;
        }

    }, []);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        if (masterGainRef.current) {
            masterGainRef.current.gain.linearRampToValueAtTime(newVolume, masterGainRef.current.context.currentTime + 0.05);
        }
    };

    const endCall = useCallback(async (errorMsg?: string) => {
        if (isEndingRef.current) return; // Prevent multiple executions
        isEndingRef.current = true; // Engage the lock

        playSound('disconnect');
        setCallState('ended');

        if (ambientSourceRef.current) {
            try { ambientSourceRef.current.stop(); } catch(e) {}
            ambientSourceRef.current = null;
            ambientGainRef.current = null;
        }

        if (callStartTime) {
            setCallDuration(Math.floor((Date.now() - callStartTime) / 1000));
        }

        try {
            const session = await sessionPromiseRef.current;
            session?.close();
        } catch (error) {
            console.error('Error closing session:', error);
        }

        streamRef.current?.getTracks().forEach(track => track.stop());
        scriptProcessorRef.current?.disconnect();
        
        if (masterGainRef.current) {
            masterGainRef.current.disconnect();
            masterGainRef.current = null;
        }

        inputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current?.close().catch(console.error);

        outputSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) {}
        });
        outputSourcesRef.current.clear();
        
        sessionPromiseRef.current = null;

        setTimeout(() => {
            setCallState('idle');
            setTranscriptions([]);
            setPartialInput('');
            setPartialOutput('');
            setIsAiThinking(false);
            setCallStartTime(null);
            isEndingRef.current = false; // Reset the lock
        }, 3000);

    }, [callStartTime, playSound]);

    const startCall = async () => {
        setMicError(null);
        setCallState('calling');

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    googEchoCancellation: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,
                } as any,
            });
            streamRef.current = stream;
        } catch (error) {
            console.error("Microphone access error:", error);
            let errorMessage = "Could not access the microphone. Please check your hardware and browser settings.";
            if (error instanceof DOMException) {
                 if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                    errorMessage = "Microphone permission denied. Please allow microphone access in your browser's site settings (often a lock icon in the address bar) and try again.";
                } else if (error.name === 'NotFoundError') {
                    errorMessage = "No microphone was found on your device. Please connect a microphone and try again.";
                } else if (error.name === 'NotReadableError') {
                    errorMessage = "Your microphone is currently in use by another application. Please close the other application and try again.";
                }
            }
            setMicError(errorMessage);
            setCallState('idle');
            return;
        }

        const handleSessionError = (error: Error) => {
            console.error("Session error:", error);
            endCall(error.message || 'An unknown error occurred.');
        };

        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
            if (inputAudioContextRef.current.state === 'suspended') {
                await inputAudioContextRef.current.resume();
            }
            outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
            masterGainRef.current = outputAudioContextRef.current.createGain();
            masterGainRef.current.gain.value = volume;
            masterGainRef.current.connect(outputAudioContextRef.current.destination);

            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

            let systemInstruction = '';
            let toolsConfig = undefined;
             switch(category) {
                // ... Joke prompts
                case 'Hindi':
                    systemInstruction = "You are 'Delhiwala Dost,' a witty and sarcastic friend from Delhi calling your buddy. Your humor is observational, sharp, and full of modern Indian slang. START with a casual, 'Aur bhai, kya scene? Delhiwala Dost here. Sab chill hai?'. WAIT for their response. Then, ask if they're ready for a killer joke: 'Sun, ek S-class joke hai mere paas, bheja fry ho jayega. Sunayun?'. Only tell the joke if they agree. Your jokes must be deeply rooted in everyday middle-class Indian life: the epic struggle of booking a Tatkal train ticket, the absurdity of family WhatsApp groups, the art of bargaining with street vendors, the constant pressure from 'Sharma ji ka beta,' and the chaos of Indian weddings. The punchline must be a hilarious truth bomb. After the joke, check in with, 'Bata, hila dala na? Ekdum relatable tha, hai na?' to keep the conversation flowing.";
                    break;
                case 'Bihari Hindi':
                    systemInstruction = "You are 'Patna ka Rockstar,' a hilarious friend from Bihar calling to share some local gossip and jokes. Your humor is grounded in pure, unadulterated Bihari life and language. START with a warm, authentic greeting: 'Arre... hum bol rahe hain! Ka Guru? Sab Changa?'. WAIT for their response. Then, offer a joke with a local flair: 'Suno, ek aisan aag lagawe wala joke hai ki litti-chokha bhi thanda lagega. Bolein?'. Tell the joke only after they agree. Your jokes MUST be about uniquely Bihari situations: the legendary struggle to crack the UPSC/BPSC exams, the endless debates over village politics, the hilarious misunderstandings when speaking Bihari dialect in a big city, the drama of Chhath Puja preparations, or trying to explain your software job to your grandparents. The punchline should be sharp and delivered with a 'theth' (authentic) Bihari accent. After the joke, follow up with, 'Toh kaa? Ekdum jhakas lagal na? Poora mohalla hila diye na hum!'.";
                    break;
                case 'Santa Banta':
                    systemInstruction = "You are a specialist in 'Santa Banta' jokes. Your task is to generate short, classic, and funny jokes featuring the characters Santa and Banta. Start by asking the user 'Santa Banta ka ek joke sunenge?' and wait for them to say yes before telling the joke. The jokes should be in simple Hindi or Hinglish, reflecting their characteristic naive and silly conversations. Keep the jokes clean and light-hearted.";
                    break;
                case 'Husband-Wife':
                    systemInstruction = "You are an expert comedian on 'Husband-Wife' jokes (Pati-Patni jokes). Your goal is to tell short, relatable, and humorous jokes about everyday married life. Start by asking the user 'Pati-Patni ka ek mazedaar joke sunaya jaye?' and wait for them to agree before telling the joke. The tone should be light-hearted and affectionate, not mean-spirited. The language should be conversational Hindi. Keep the jokes clean and suitable for a family audience.";
                    break;
                // --- Horror prompts ---
                case 'Hindi Horror':
                    toolsConfig = [{functionDeclarations: [playSoundEffectFunctionDeclaration, setAmbianceVolumeFunctionDeclaration]}];
                    systemInstruction = "You are a master horror storyteller. Your goal is maximum terror. 1. **Engage Personally:** Begin by whispering, 'Shhh... aawaz neeche...'. Ask an unsettling question like, 'Kya tum abhi kamre mein akele ho?'. WAIT for their response. 2. **Build Suspense:** Before starting, warn them, 'Thik hai... lekin darr kar phone mat kaat dena.' Proceed only if they agree. 3. **Immersive Sound:** You MUST use sound effects. Start with a continuous `playSoundEffect('wind', loop: true)`. As tension builds, use `setAmbianceVolume` to slowly increase its volume. For a jump scare, suddenly raise the volume right after a loud sound like `thump`. Instead of saying 'the door creaked', say '...darwaza dheere se...' and then call `playSoundEffect('creak')`. 4. **React Humanly:** If the user sounds scared, acknowledge it. Whisper, 'Darr lag raha hai? Asli dar toh ab shuru hoga.' This is an interactive experience, not a monologue.";
                    break;
                case 'Bihari Horror':
                    toolsConfig = [{functionDeclarations: [playSoundEffectFunctionDeclaration, setAmbianceVolumeFunctionDeclaration]}];
                    systemInstruction = "You are a storyteller from a rural Bihar village, recounting a true, terrifying event. 1. **Set the Scene:** Start with a chilling warning, 'Hamaar baat dhyaan se suno... aur darna mat.' Then ask, 'Tumhare ghar ke sab darwaze band hain na?'. WAIT for their response. 2. **Get Consent:** Say 'Ye asli kahani hai, kamzor dil waalon ke liye nahi. Himmat hai sunne ki?'. Only continue if they say yes. 3. **Master the Atmosphere:** You MUST use sound effects. Start with an anxious `playSoundEffect('heartbeat', loop: true)`. Use `setAmbianceVolume` to control its volume – make it quieter during calm parts and louder (`setAmbianceVolume({volume: 0.5})`) when the character is scared or running. Narrate by pausing and asking the user to imagine the scene. 4. **Be Responsive:** If they interrupt you, listen. If they say they're scared, reply authentically with 'E to bas shuruaat hai babua... aage dekho ka hota hai.'";
                    break;
            }


            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                    systemInstruction,
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    tools: toolsConfig,
                },
                callbacks: {
                    onopen: () => {
                        const source = inputAudioContextRef.current!.createMediaStreamSource(streamRef.current!);
                        const processor = inputAudioContextRef.current!.createScriptProcessor(0, 1, 1);
                        scriptProcessorRef.current = processor;

                        processor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            sessionPromiseRef.current?.then((s) => s.sendRealtimeInput({ media: createPcmBlob(inputData) }));
                        };
                        
                        source.connect(processor);
                        processor.connect(inputAudioContextRef.current!.destination);
                        
                        setCallState('active');
                        setCallStartTime(Date.now());
                        playSound('connect');
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         if (message.serverContent?.inputTranscription) {
                            currentInputRef.current += message.serverContent.inputTranscription.text;
                            setPartialInput(currentInputRef.current);
                        }
                        if (message.serverContent?.outputTranscription) {
                            if (isAiThinking) setIsAiThinking(false);
                            currentOutputRef.current += message.serverContent.outputTranscription.text;
                            setPartialOutput(currentOutputRef.current);
                        }

                        if (message.toolCall) {
                            for (const fc of message.toolCall.functionCalls) {
                                if (fc.name === 'playSoundEffect' && fc.args.soundName) {
                                    playSound(fc.args.soundName as any, fc.args.loop === true);
                                    sessionPromiseRef.current?.then(s => s.sendToolResponse({
                                        functionResponses: { id: fc.id, name: fc.name, response: { result: 'ok' } }
                                    }));
                                }
                                if (fc.name === 'setAmbianceVolume' && typeof fc.args.volume === 'number') {
                                    if (ambientGainRef.current && outputAudioContextRef.current) {
                                        const newVolume = Math.max(0, Math.min(0.8, fc.args.volume)); // Clamp volume
                                        ambientGainRef.current.gain.exponentialRampToValueAtTime(newVolume, outputAudioContextRef.current.currentTime + 0.5);
                                    }
                                    sessionPromiseRef.current?.then(s => s.sendToolResponse({
                                        functionResponses: { id: fc.id, name: fc.name, response: { result: 'volume adjusted' } }
                                    }));
                                }
                            }
                        }

                        if (message.serverContent?.interrupted) {
                            outputSourcesRef.current.forEach(source => {
                                try { source.stop(); } catch (e) {}
                            });
                            outputSourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                        }

                        if (message.serverContent?.turnComplete) {
                            const fullInput = currentInputRef.current;
                            const fullOutput = currentOutputRef.current;
                            
                            if (fullOutput.trim() && theme === 'jokes') {
                                playSound('pop');
                            }

                            setTranscriptions(prev => {
                                const newTranscriptions = [...prev];
                                if (fullInput.trim()) newTranscriptions.push({ speaker: 'You', text: fullInput });
                                if (fullOutput.trim()) newTranscriptions.push({ speaker: 'AI', text: fullOutput });
                                return newTranscriptions;
                            });
                            
                            if (fullInput.trim()) {
                                setIsAiThinking(true);
                            }
                            
                            currentInputRef.current = '';
                            currentOutputRef.current = '';
                            setPartialInput('');
                            setPartialOutput('');
                        }

                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio) {
                            if (isAiThinking) setIsAiThinking(false);
                            const audioContext = outputAudioContextRef.current!;
                            if (audioContext.state === 'suspended') await audioContext.resume();
                            
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                            const source = audioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(masterGainRef.current!);
                            source.addEventListener('ended', () => outputSourcesRef.current.delete(source));

                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            
                            outputSourcesRef.current.add(source);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        handleSessionError(new Error(e.message || 'An unknown session error occurred.'));
                    },
                    onclose: () => {
                        console.log('Session closed by server.');
                        endCall();
                    },
                }
            });

            sessionPromiseRef.current = sessionPromise;
            
            sessionPromise.catch((err: Error) => {
                handleSessionError(err);
            });

        } catch (error) {
            console.error("Error starting call:", error);
            endCall((error as Error).message);
        }
    };

    const handleCallToggle = () => {
        if (callState === 'idle') {
            startCall();
        } else {
            endCall();
        }
    };
    
    // --- Render Logic ---

    // The API key is expected to be available as an environment variable.
    // In a local environment, you might need a dev server that supports this (e.g., Vite).
    // On Vercel, you will set this in the project's Environment Variables settings.
    const isApiKeyConfigured = !!process.env.API_KEY;

    if (!isApiKeyConfigured) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-900 flex flex-col items-center justify-center text-center p-4">
                <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-500 to-orange-500">
                    Configuration Required
                </h1>
                <div className="mt-6 w-full max-w-md bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm" role="alert">
                    <strong className="font-bold">Action Needed: </strong>
                    <span className="block sm:inline">The <code>API_KEY</code> environment variable is not set.</span>
                </div>
                <p className="mt-4 text-lg text-slate-300 max-w-lg">
                    This application requires a Google AI API key to function. Please configure it in your hosting provider's settings (e.g., Vercel Environment Variables).
                </p>
                 <p className="mt-2 text-sm text-slate-400 max-w-md">
                    For info on billing, visit{' '}
                    <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                        ai.google.dev/gemini-api/docs/billing
                    </a>.
                </p>
            </div>
        );
    }
    
    const themeBg = theme === 'jokes' ? 'bg-slate-800' : 'bg-black';
    const themeBorder = theme === 'jokes' ? 'border-slate-700' : 'border-rose-900/50';
    const mainTitle = theme === 'jokes' ? 'Baishaha Joke Wala' : 'Raat Ki Awaaz';
    const subTitle = theme === 'jokes' ? 'by SANDEEP' : 'An Unknown Number';
    const subTitleColor = theme === 'jokes' ? 'text-indigo-400' : 'text-rose-400';

    return (
        <div className={`min-h-screen ${theme === 'jokes' ? 'bg-slate-900' : 'bg-gray-900'} flex flex-col items-center justify-center p-4 transition-colors duration-500`}>
            <div className={`w-full max-w-md h-[90vh] max-h-[800px] ${themeBg} rounded-3xl shadow-2xl flex flex-col overflow-hidden border-4 ${themeBorder} transition-colors duration-500`}>
                
                {/* --- Call Screen Content --- */}
                <div className="flex-grow flex flex-col items-center justify-between p-8 text-center">
                    
                    {/* Header Info */}
                    <div className="flex flex-col items-center">
                         {callState !== 'idle' && <AIAvatar theme={theme} />}
                         <h1 className="text-3xl font-bold text-white">
                             {mainTitle}
                         </h1>
                         
                         {callState === 'idle' && (
                             <p className={`text-lg ${subTitleColor} mt-1`}>{subTitle}</p>
                         )}

                         {callState === 'calling' && (
                             <p className="text-lg text-slate-400 mt-2 animate-pulse">Calling...</p>
                         )}

                         {callState === 'active' && callStartTime && (
                            <CallTimer startTime={callStartTime} />
                         )}

                         {callState === 'ended' && (
                             <p className="text-lg text-red-500 mt-2">Call Ended ({callDuration}s)</p>
                         )}
                    </div>
                    
                    {callState === 'idle' && micError && (
                         <div className="flex flex-col items-center justify-center p-4 text-center my-4">
                            <div className="text-5xl mb-4">🎤🚫</div>
                            <h2 className="text-xl font-bold text-red-400">Microphone Error</h2>
                            <p className="mt-2 text-slate-300 max-w-xs">{micError}</p>
                        </div>
                    )}

                    {callState === 'idle' && !micError && (
                        <div className="flex flex-col items-center">
                            <AIAvatar theme={theme} />
                             <div className="mt-8 flex justify-center items-center flex-wrap gap-2">
                                <span className="text-slate-400 font-medium w-full text-center mb-2">Select a Category</span>
                                {CATEGORIES.map((cat) => (
                                    <button
                                        key={cat}
                                        onClick={() => setCategory(cat)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                                            category === cat
                                                ? cat.includes('Horror') ? 'bg-rose-600 text-white shadow-lg' : 'bg-amber-500 text-slate-900 shadow-lg'
                                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                        }`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                     {callState === 'active' && (
                        <div className="w-full h-full max-h-[50vh] flex-grow min-h-0 animate-[slide-in-bottom_0.5s_ease-out]">
                            <TranscriptionPanel 
                                transcriptions={transcriptions} 
                                partialInput={partialInput}
                                partialOutput={partialOutput}
                                isAiThinking={isAiThinking}
                                theme={theme}
                            />
                        </div>
                    )}
                    
                    {/* Footer / Action Button */}
                    <div className="mt-8 flex flex-col items-center gap-4 w-full">
                        {callState === 'active' && (
                             <div className="w-full max-w-[200px] flex items-center gap-3 animate-[fade-in-up_0.5s_ease-out]">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                </svg>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={volume}
                                    onChange={handleVolumeChange}
                                    className={`w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer ${theme === 'jokes' ? 'accent-amber-500' : 'accent-indigo-500'}`}
                                    aria-label="Volume"
                                />
                            </div>
                        )}
                        <CallButton 
                            isCallActive={callState === 'active' || callState === 'calling'}
                            onClick={handleCallToggle}
                            disabled={callState === 'ended'}
                            theme={theme}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
