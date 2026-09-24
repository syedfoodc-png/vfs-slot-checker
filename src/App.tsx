/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell,
  BellRing,
  Volume2,
  VolumeX,
  Play,
  Square,
  ShieldCheck,
  AlertTriangle,
  Send,
  ExternalLink,
  RefreshCw,
  Clock,
  MapPin,
  Flame,
  CheckCircle2,
  Info,
  Radio,
  Settings,
  Sparkles,
  Zap,
  Globe,
  Sliders,
  FileCheck,
  Code2,
  HelpCircle,
  Copy,
  Check,
  Calendar,
  Terminal,
  ChevronDown,
  ChevronUp,
  FileText
} from 'lucide-react';

interface CheckLog {
  id: string;
  timestamp: string;
  center: string;
  category: string;
  status: 'no_slots' | 'slot_open' | 'rate_limited' | 'error' | 'checking';
  message: string;
  detectedDates?: string[];
  httpCode?: number;
  durationMs: number;
}

export default function App() {
  // Input settings
  const [slotApiUrl, setSlotApiUrl] = useState(
    'https://visa.vfsglobal.com/ind/en/deu/api/appointment/slots?vacCode=HYD&visaCategoryCode=NAT_CHANCENKARTE'
  );
  const [authToken, setAuthToken] = useState('');
  const [selectedCenter, setSelectedCenter] = useState('Hyderabad');
  const [categoryName] = useState('National Visa > Chancenkarte');
  const [checkIntervalMin, setCheckIntervalMin] = useState<number>(2);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [engineMode, setEngineMode] = useState<'simulated' | 'proxy' | 'manual_paste'>('simulated');
  const [corsProxyUrl, setCorsProxyUrl] = useState('https://api.allorigins.win/raw?url=');

  // Manual Paste / Inspection Payload
  const [pastedPayload, setPastedPayload] = useState(
    '{\n  "vacCode": "HYD",\n  "visaCategoryCode": "NAT_CHANCENKARTE",\n  "availableDates": []\n}'
  );
  const [lastParsedDates, setLastParsedDates] = useState<string[]>([]);

  // Monitor execution state
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [status, setStatus] = useState<'idle' | 'checking' | 'no_slots' | 'slot_open' | 'rate_limited'>('idle');
  const [lastCheckedTime, setLastCheckedTime] = useState<string | null>(null);
  const [checkCount, setCheckCount] = useState(0);
  const [nextCheckSeconds, setNextCheckSeconds] = useState(0);
  const [alarmActive, setAlarmActive] = useState(false);
  const [isSoundMuted, setIsSoundMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [consecutiveRateLimits, setConsecutiveRateLimits] = useState(0);
  const [currentBackoffDelay, setCurrentBackoffDelay] = useState(0);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );

  // UI state
  const [showHelpBox, setShowHelpBox] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<{ type: 'success' | 'error' | 'idle'; msg: string }>({
    type: 'idle',
    msg: ''
  });

  // Logs
  const [logs, setLogs] = useState<CheckLog[]>([]);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const titleIntervalRef = useRef<number | null>(null);

  const centers = ['Hyderabad', 'Bangalore', 'Mumbai', 'Chennai', 'New Delhi', 'Kolkata'];

  // Request Notification permission
  const requestNotificationPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      return perm;
    }
    return 'denied';
  };

  // Web Audio Alarm Player
  const startAudioAlarm = useCallback(() => {
    if (isSoundMuted) return;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      const playTone = (freq: number, duration: number) => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') return;
        const osc = audioContextRef.current.createOscillator();
        const gain = audioContextRef.current.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, audioContextRef.current.currentTime);
        gain.gain.setValueAtTime(volume * 0.35, audioContextRef.current.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + duration);

        osc.connect(gain);
        gain.connect(audioContextRef.current.destination);
        osc.start();
        osc.stop(audioContextRef.current.currentTime + duration);
      };

      playTone(920, 0.25);
      setTimeout(() => playTone(1280, 0.35), 260);

      if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = window.setInterval(() => {
        playTone(920, 0.25);
        setTimeout(() => playTone(1280, 0.35), 260);
      }, 700);

      // Hinglish voice alert via SpeechSynthesis
      if ('speechSynthesis' in window && !isSoundMuted) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          'Bhai Slot Khul Gaya! Jaldi Book Karo! Germany Opportunity Card slot open at ' + selectedCenter + '!'
        );
        utterance.rate = 1.05;
        utterance.pitch = 1.15;
        utterance.volume = volume;
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }, [isSoundMuted, volume, selectedCenter]);

  const stopAudioAlarm = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (titleIntervalRef.current) {
      clearInterval(titleIntervalRef.current);
      titleIntervalRef.current = null;
      document.title = 'VFS Slot Alert - Germany Opportunity Card';
    }
    setAlarmActive(false);
  }, []);

  const startTitleFlashing = useCallback(() => {
    if (titleIntervalRef.current) clearInterval(titleIntervalRef.current);
    let flag = false;
    titleIntervalRef.current = window.setInterval(() => {
      document.title = flag
        ? '🚨 (1) BHAI SLOT KHUL GAYA! JALDI BOOK KARO! 🚨'
        : '🟢 CHANCENKARTE SLOT OPEN - VFS INDIA';
      flag = !flag;
    }, 600);
  }, []);

  // Send Telegram Message
  const sendTelegramAlert = useCallback(
    async (textMessage: string) => {
      if (!telegramToken.trim() || !telegramChatId.trim()) return false;
      try {
        const cleanToken = telegramToken.trim();
        const cleanChat = telegramChatId.trim();
        const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cleanChat,
            text: textMessage,
            parse_mode: 'Markdown'
          })
        });
        return res.ok;
      } catch (err) {
        console.error('Telegram dispatch error:', err);
        return false;
      }
    },
    [telegramToken, telegramChatId]
  );

  const handleTestTelegram = async () => {
    if (!telegramToken.trim() || !telegramChatId.trim()) {
      setTelegramStatus({
        type: 'error',
        msg: 'Please enter Bot Token and Chat ID first!'
      });
      return;
    }
    setTelegramStatus({ type: 'idle', msg: 'Sending test message...' });
    const success = await sendTelegramAlert(
      `🔔 *VFS Chancenkarte Alert Test*\n\nYour mobile alert channel for *National Visa > Opportunity Card* is connected!\n\n_Bhai Slot Khul Gaya! Jaldi Book Karo!_ will alert you here immediately.`
    );
    if (success) {
      setTelegramStatus({ type: 'success', msg: '✅ Test message delivered! Check Telegram.' });
    } else {
      setTelegramStatus({
        type: 'error',
        msg: '❌ Failed to send. Please check your Bot Token & Chat ID.'
      });
    }
    setTimeout(() => {
      setTelegramStatus({ type: 'idle', msg: '' });
    }, 5000);
  };

  // Trigger Slot Detected Alert
  const triggerSlotAlert = useCallback(
    (center: string, detectedDates: string[]) => {
      setAlarmActive(true);
      setStatus('slot_open');
      setLastParsedDates(detectedDates);

      startAudioAlarm();
      startTitleFlashing();

      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('🔥 BHAI SLOT KHUL GAYA! JALDI BOOK KARO!', {
            body: `National Visa > Chancenkarte slot OPEN at ${center}! Available dates: ${
              detectedDates.length > 0 ? detectedDates.join(', ') : 'Dates Available'
            }. Book now!`,
            tag: 'vfs-chancenkarte-alert',
            requireInteraction: true
          });
        }
      }

      const timeStr = new Date().toLocaleTimeString();
      const dateText = detectedDates.length > 0 ? detectedDates.join(', ') : 'Appointment slot open';
      const tgMsg =
        `🚨🚨 *VFS CHANCENKARTE SLOT OPEN!* 🚨🚨\n\n` +
        `*Bhai Slot Khul Gaya! Jaldi Book Karo!*\n\n` +
        `📍 *Category:* National Visa > Chancenkarte - ${center}\n` +
        `📅 *Dates:* ${dateText}\n` +
        `⏰ *Time:* ${timeStr}\n` +
        `🔗 *VFS Login:* https://visa.vfsglobal.com/ind/en/deu/\n\n` +
        `⚠️ *Action:* Complete pre-approved CSP appointment confirmation right away. Auto-booking bot is OFF for account safety!`;
      sendTelegramAlert(tgMsg);
    },
    [startAudioAlarm, startTitleFlashing, sendTelegramAlert]
  );

  /**
   * Calendar & API Evaluator Logic
   * Evaluates if JSON response has enabled dates (non-empty array)
   * Or if HTML calendar has enabled dates (elements without .disabled)
   */
  const evaluateCalendarResponse = useCallback(
    (
      payload: string
    ): {
      hasSlot: boolean;
      dates: string[];
      details: string;
    } => {
      const trimmed = payload.trim();
      if (!trimmed) {
        return { hasSlot: false, dates: [], details: 'Empty payload received' };
      }

      // 1. Try parsing as JSON (standard VFS Slot API response)
      try {
        const json = JSON.parse(trimmed);

        // Case A: Response is an array of dates: ["2026-10-15", "2026-10-16"]
        if (Array.isArray(json)) {
          if (json.length === 0) {
            return {
              hasSlot: false,
              dates: [],
              details: 'Calendar API returned empty array [] (No slots enabled)'
            };
          }
          const dates = json
            .map((item) => (typeof item === 'string' ? item : item?.date || item?.appointmentDate || JSON.stringify(item)))
            .filter(Boolean);
          return {
            hasSlot: true,
            dates,
            details: `Calendar API returned ${dates.length} enabled date(s): ${dates.join(', ')}`
          };
        }

        // Case B: Response is an object with slots/availableDates/dates
        if (typeof json === 'object' && json !== null) {
          const potentialArrays = [
            json.availableDates,
            json.availableSlots,
            json.slots,
            json.dates,
            json.appointmentDates,
            json.slotList
          ];

          for (const arr of potentialArrays) {
            if (Array.isArray(arr)) {
              if (arr.length > 0) {
                const dates = arr
                  .map((item) => (typeof item === 'string' ? item : item?.date || item?.slotDate || item?.time || JSON.stringify(item)))
                  .filter(Boolean);
                return {
                  hasSlot: true,
                  dates,
                  details: `Enabled calendar slots detected: ${dates.join(', ')}`
                };
              } else {
                return {
                  hasSlot: false,
                  dates: [],
                  details: 'Calendar API array is empty [] (No available slots)'
                };
              }
            }
          }

          if (json.earliestDate && typeof json.earliestDate === 'string' && json.earliestDate.trim()) {
            return {
              hasSlot: true,
              dates: [json.earliestDate],
              details: `Earliest date confirmed: ${json.earliestDate}`
            };
          }

          if (json.hasSlots === true || json.isSlotAvailable === true) {
            return {
              hasSlot: true,
              dates: ['Earliest date open'],
              details: 'API flag indicates available slots'
            };
          }

          if (json.hasSlots === false || json.error || json.message) {
            return {
              hasSlot: false,
              dates: [],
              details: json.message || json.error || 'API reported no slots available'
            };
          }
        }
      } catch {
        // Not valid JSON, proceed to HTML/DOM analysis
      }

      // 2. HTML / DOM calendar parsing
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'text/html');

      // VFS calendar classes: Angular Material datepicker (mat-calendar-body-cell)
      const allCells = doc.querySelectorAll(
        '.mat-calendar-body-cell, .calendar-day, td[role="gridcell"], .day-cell'
      );

      if (allCells.length > 0) {
        const enabledCells: string[] = [];
        allCells.forEach((cell) => {
          const classList = cell.className.toLowerCase();
          const isDisabled =
            classList.includes('disabled') ||
            classList.includes('mat-calendar-body-disabled') ||
            cell.getAttribute('aria-disabled') === 'true';

          if (!isDisabled) {
            const dateLabel =
              cell.getAttribute('aria-label') ||
              cell.getAttribute('data-date') ||
              cell.textContent?.trim() ||
              'Enabled Date';
            if (dateLabel && dateLabel.length > 0) {
              enabledCells.push(dateLabel);
            }
          }
        });

        if (enabledCells.length > 0) {
          return {
            hasSlot: true,
            dates: enabledCells,
            details: `HTML calendar has ${enabledCells.length} enabled date(s): ${enabledCells.join(', ')}`
          };
        } else {
          return {
            hasSlot: false,
            dates: [],
            details: 'All calendar date cells are disabled in HTML'
          };
        }
      }

      // 3. Fallback text pattern matching for "enabled", dates, or "no slots"
      const lowerText = trimmed.toLowerCase();
      const explicitDates = trimmed.match(/\b202[5-7]-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g);
      if (explicitDates && explicitDates.length > 0) {
        return {
          hasSlot: true,
          dates: explicitDates,
          details: `Found enabled appointment dates in payload: ${explicitDates.join(', ')}`
        };
      }

      if (
        lowerText.includes('no appointment') ||
        lowerText.includes('no slots') ||
        lowerText.includes('currently no available') ||
        lowerText.includes('all slots are booked')
      ) {
        return {
          hasSlot: false,
          dates: [],
          details: 'Text indicates no slots are available'
        };
      }

      return {
        hasSlot: false,
        dates: [],
        details: 'No enabled calendar dates found in payload'
      };
    },
    []
  );

  // Manual analysis of pasted payload
  const handleAnalyzePastedPayload = () => {
    const timeStr = new Date().toLocaleTimeString();
    const result = evaluateCalendarResponse(pastedPayload);
    const categoryLogLabel = `National Visa > Chancenkarte - ${selectedCenter}`;

    setLastCheckedTime(timeStr);
    setCheckCount((prev) => prev + 1);

    if (result.hasSlot) {
      setLastParsedDates(result.dates);
      const newLog: CheckLog = {
        id: Math.random().toString(),
        timestamp: timeStr,
        center: selectedCenter,
        category: categoryLogLabel,
        status: 'slot_open',
        message: `SLOT OPEN! ${result.details}`,
        detectedDates: result.dates,
        httpCode: 200,
        durationMs: 15
      };
      setLogs((prev) => [newLog, ...prev]);
      triggerSlotAlert(selectedCenter, result.dates);
    } else {
      setStatus('no_slots');
      setLastParsedDates([]);
      const newLog: CheckLog = {
        id: Math.random().toString(),
        timestamp: timeStr,
        center: selectedCenter,
        category: categoryLogLabel,
        status: 'no_slots',
        message: `Checking: ${categoryLogLabel} -> No slots (All dates disabled/empty)`,
        httpCode: 200,
        durationMs: 15
      };
      setLogs((prev) => [newLog, ...prev]);
    }
  };

  // Main check function
  const performCheck = useCallback(async () => {
    const startTime = performance.now();
    setStatus('checking');
    const timeStr = new Date().toLocaleTimeString();
    const categoryLogLabel = `National Visa > Chancenkarte - ${selectedCenter}`;

    if (engineMode === 'manual_paste') {
      // Analyze current pasted payload
      const result = evaluateCalendarResponse(pastedPayload);
      const duration = Math.round(performance.now() - startTime);
      setLastCheckedTime(timeStr);
      setCheckCount((prev) => prev + 1);

      if (result.hasSlot) {
        setLastParsedDates(result.dates);
        const newLog: CheckLog = {
          id: Math.random().toString(),
          timestamp: timeStr,
          center: selectedCenter,
          category: categoryLogLabel,
          status: 'slot_open',
          message: `SLOT OPEN! ${result.details}`,
          detectedDates: result.dates,
          httpCode: 200,
          durationMs: duration
        };
        setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
        triggerSlotAlert(selectedCenter, result.dates);
      } else {
        setStatus('no_slots');
        const newLog: CheckLog = {
          id: Math.random().toString(),
          timestamp: timeStr,
          center: selectedCenter,
          category: categoryLogLabel,
          status: 'no_slots',
          message: `Checking: ${categoryLogLabel} -> No slots (${result.details})`,
          httpCode: 200,
          durationMs: duration
        };
        setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
      }
      return;
    }

    if (engineMode === 'simulated') {
      await new Promise((r) => setTimeout(r, 1100));
      const duration = Math.round(performance.now() - startTime);
      setLastCheckedTime(timeStr);
      setCheckCount((prev) => prev + 1);
      setConsecutiveRateLimits(0);
      setCurrentBackoffDelay(0);

      // Simulation evaluates to no slots by default
      setStatus('no_slots');
      const newLog: CheckLog = {
        id: Math.random().toString(),
        timestamp: timeStr,
        center: selectedCenter,
        category: categoryLogLabel,
        status: 'no_slots',
        message: `Checking: ${categoryLogLabel} -> Calendar API returned [] (No enabled dates)`,
        httpCode: 200,
        durationMs: duration
      };
      setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
    } else {
      // Live Proxy / Internal API Mode
      try {
        const targetUrl = corsProxyUrl.trim()
          ? `${corsProxyUrl.trim()}${encodeURIComponent(slotApiUrl.trim())}`
          : slotApiUrl.trim();

        const headers: Record<string, string> = {
          Accept: 'application/json, text/html, */*'
        };
        if (authToken.trim()) {
          headers['Authorization'] = authToken.trim().startsWith('Bearer ')
            ? authToken.trim()
            : `Bearer ${authToken.trim()}`;
        }

        const response = await fetch(targetUrl, { headers });
        const duration = Math.round(performance.now() - startTime);
        setLastCheckedTime(timeStr);
        setCheckCount((prev) => prev + 1);

        if (response.status === 429) {
          const newCount = consecutiveRateLimits + 1;
          setConsecutiveRateLimits(newCount);
          const backoffMinutes = Math.min(checkIntervalMin * Math.pow(2, newCount), 30);
          setCurrentBackoffDelay(backoffMinutes * 60);
          setStatus('rate_limited');

          const newLog: CheckLog = {
            id: Math.random().toString(),
            timestamp: timeStr,
            center: selectedCenter,
            category: categoryLogLabel,
            status: 'rate_limited',
            message: `Checking: ${categoryLogLabel} -> HTTP 429 Rate Limit. Backing off ${backoffMinutes} min`,
            httpCode: 429,
            durationMs: duration
          };
          setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
          return;
        }

        const rawText = await response.text();
        const evalResult = evaluateCalendarResponse(rawText);

        if (evalResult.hasSlot) {
          setLastParsedDates(evalResult.dates);
          const newLog: CheckLog = {
            id: Math.random().toString(),
            timestamp: timeStr,
            center: selectedCenter,
            category: categoryLogLabel,
            status: 'slot_open',
            message: `SLOT OPEN! ${evalResult.details}`,
            detectedDates: evalResult.dates,
            httpCode: response.status,
            durationMs: duration
          };
          setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
          triggerSlotAlert(selectedCenter, evalResult.dates);
        } else {
          setStatus('no_slots');
          setConsecutiveRateLimits(0);
          const newLog: CheckLog = {
            id: Math.random().toString(),
            timestamp: timeStr,
            center: selectedCenter,
            category: categoryLogLabel,
            status: 'no_slots',
            message: `Checking: ${categoryLogLabel} -> No slots (${evalResult.details})`,
            httpCode: response.status,
            durationMs: duration
          };
          setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
        }
      } catch (err: unknown) {
        const duration = Math.round(performance.now() - startTime);
        const errorMsg = err instanceof Error ? err.message : 'Network/CORS error';
        setStatus('rate_limited');
        const newLog: CheckLog = {
          id: Math.random().toString(),
          timestamp: timeStr,
          center: selectedCenter,
          category: categoryLogLabel,
          status: 'error',
          message: `Checking: ${categoryLogLabel} -> Fetch failed (${errorMsg}). Switch to Manual Paste or Simulator if CORS blocked.`,
          httpCode: 0,
          durationMs: duration
        };
        setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
      }
    }
  }, [
    engineMode,
    pastedPayload,
    selectedCenter,
    evaluateCalendarResponse,
    triggerSlotAlert,
    corsProxyUrl,
    slotApiUrl,
    authToken,
    consecutiveRateLimits,
    checkIntervalMin
  ]);

  // Sample payloads loaders for quick testing
  const loadEmptyCalendarSample = () => {
    setPastedPayload(
      JSON.stringify(
        {
          vacCode: selectedCenter.slice(0, 3).toUpperCase(),
          visaCategoryCode: 'NAT_CHANCENKARTE',
          availableDates: [],
          message: 'No available appointment slots at this time.'
        },
        null,
        2
      )
    );
  };

  const loadSlotOpenCalendarSample = () => {
    setPastedPayload(
      JSON.stringify(
        {
          vacCode: selectedCenter.slice(0, 3).toUpperCase(),
          visaCategoryCode: 'NAT_CHANCENKARTE',
          earliestDate: '2026-10-15',
          availableDates: ['2026-10-15', '2026-10-16', '2026-10-22'],
          slots: [
            { date: '2026-10-15', time: '09:15 AM', count: 2 },
            { date: '2026-10-16', time: '10:30 AM', count: 4 }
          ]
        },
        null,
        2
      )
    );
  };

  // Instant Simulate Slot Opening
  const handleSimulateSlotFound = () => {
    const timeStr = new Date().toLocaleTimeString();
    const demoDates = ['2026-10-15', '2026-10-18'];
    setLastCheckedTime(timeStr);
    const categoryLogLabel = `National Visa > Chancenkarte - ${selectedCenter}`;
    const newLog: CheckLog = {
      id: Math.random().toString(),
      timestamp: timeStr,
      center: selectedCenter,
      category: categoryLogLabel,
      status: 'slot_open',
      message: `[TEST TRIGGER] Slot Detected! Checking: ${categoryLogLabel} -> Dates: ${demoDates.join(', ')}`,
      detectedDates: demoDates,
      httpCode: 200,
      durationMs: 35
    };
    setLogs((prev) => [newLog, ...prev]);
    triggerSlotAlert(selectedCenter, demoDates);
  };

  // Start / Stop monitoring action
  const handleToggleMonitoring = async () => {
    if (isMonitoring) {
      setIsMonitoring(false);
      setStatus('idle');
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      stopAudioAlarm();
    } else {
      await requestNotificationPermission();
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioCtx();
        }
        if (audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume();
        }
      } catch (e) {
        console.warn('AudioContext pre-warm:', e);
      }

      setIsMonitoring(true);
      performCheck();
      const intervalSec = checkIntervalMin * 60;
      setNextCheckSeconds(intervalSec);
    }
  };

  // Schedule timer loop
  useEffect(() => {
    if (!isMonitoring) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    timerIntervalRef.current = window.setInterval(() => {
      setNextCheckSeconds((prev) => {
        if (prev <= 1) {
          if (!alarmActive) {
            performCheck();
          }
          const baseSec = currentBackoffDelay > 0 ? currentBackoffDelay : checkIntervalMin * 60;
          return baseSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isMonitoring, alarmActive, checkIntervalMin, currentBackoffDelay, performCheck]);

  useEffect(() => {
    return () => {
      if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (titleIntervalRef.current) clearInterval(titleIntervalRef.current);
    };
  }, []);

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#060a12] text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30">
      {/* Top Banner Alert Bar when Slot is Open */}
      {alarmActive && (
        <div className="bg-emerald-500 text-slate-950 font-black px-4 py-3 sticky top-0 z-50 shadow-2xl flex flex-wrap items-center justify-between gap-3 animate-pulse border-b-2 border-emerald-300">
          <div className="flex items-center gap-2 text-base md:text-lg">
            <Flame className="w-6 h-6 animate-bounce text-slate-950" />
            <span>🔥 BHAI SLOT KHUL GAYA! JALDI BOOK KARO! 🔥</span>
            <span className="bg-black/90 text-emerald-400 text-xs px-2.5 py-1 rounded font-bold uppercase tracking-wider">
              {categoryName} - {selectedCenter}
            </span>
            {lastParsedDates.length > 0 && (
              <span className="bg-emerald-950 text-white text-xs px-2.5 py-1 rounded font-mono">
                📅 {lastParsedDates.join(', ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://visa.vfsglobal.com/ind/en/deu/"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-slate-950 hover:bg-slate-900 text-emerald-300 font-bold px-4 py-1.5 rounded-lg flex items-center gap-1.5 text-sm transition-all shadow-lg active:scale-95"
            >
              <ExternalLink className="w-4 h-4" />
              Open VFS Portal
            </a>
            <button
              onClick={stopAudioAlarm}
              className="bg-red-600 hover:bg-red-700 text-white font-bold px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 transition-all active:scale-95"
            >
              <VolumeX className="w-4 h-4" />
              Stop Siren
            </button>
          </div>
        </div>
      )}

      {/* Main Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-rose-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-rose-900/20">
                <span className="text-xl">🇩🇪</span>
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    status === 'slot_open'
                      ? 'bg-emerald-400'
                      : isMonitoring
                      ? 'bg-cyan-400'
                      : 'bg-slate-500'
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-slate-950 ${
                    status === 'slot_open'
                      ? 'bg-emerald-500'
                      : isMonitoring
                      ? 'bg-cyan-500'
                      : 'bg-slate-600'
                  }`}
                />
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg md:text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                  VFS Slot Alert
                </h1>
                <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                  Chancenkarte / Opportunity Card
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Monitoring: <strong className="text-amber-300">National Visa &gt; Chancenkarte</strong> (Requires CSP Pre-approval)
              </p>
            </div>
          </div>

          {/* Quick Actions Header */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowHelpBox(!showHelpBox)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-all flex items-center gap-1.5"
            >
              <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
              <span>{showHelpBox ? 'Hide Setup Guide' : 'How to Monitor?'}</span>
            </button>

            <button
              onClick={requestNotificationPermission}
              className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
                notificationPermission === 'granted'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
            >
              {notificationPermission === 'granted' ? (
                <>
                  <BellRing className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Alerts Enabled</span>
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5 text-slate-400" />
                  <span className="hidden sm:inline">Enable Alerts</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <button
                onClick={() => setIsSoundMuted(!isSoundMuted)}
                className="text-slate-400 hover:text-white transition-colors"
                title={isSoundMuted ? 'Unmute' : 'Mute'}
              >
                {isSoundMuted ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                )}
              </button>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-14 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            <button
              onClick={() => {
                if (alarmActive) {
                  stopAudioAlarm();
                } else {
                  startAudioAlarm();
                  setAlarmActive(true);
                  setTimeout(() => stopAudioAlarm(), 3000);
                }
              }}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-all"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">{alarmActive ? 'Stop Siren' : 'Test Sound'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Prominent Help Box: How to get the correct URL & API payload to monitor */}
        {showHelpBox && (
          <section className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/40 border border-indigo-500/30 rounded-2xl p-5 shadow-xl relative">
            <button
              onClick={() => setShowHelpBox(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white text-xs bg-slate-800/80 px-2 py-1 rounded"
            >
              ✕ Dismiss
            </button>

            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                <HelpCircle className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  How to get the correct URL to monitor Opportunity Card?
                  <span className="bg-amber-500/20 text-amber-300 text-[11px] font-semibold px-2 py-0.5 rounded border border-amber-500/30">
                    Important
                  </span>
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Germany Opportunity Card (Chancenkarte) slots are <strong>never</strong> on the public front page. They appear only after Consular Service Portal (CSP) pre-approval and are loaded via an internal calendar API.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-2">
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs space-y-1">
                    <span className="text-indigo-400 font-bold font-mono">STEP 1</span>
                    <p className="text-slate-300">
                      <strong>Complete CSP Pre-approval:</strong> Finish your initial assessment at{' '}
                      <span className="text-indigo-300 underline">digital.diplo.de</span> and receive your reference file.
                    </p>
                  </div>
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs space-y-1">
                    <span className="text-indigo-400 font-bold font-mono">STEP 2</span>
                    <p className="text-slate-300">
                      <strong>Login to VFS:</strong> Start New Booking &gt; Select{' '}
                      <strong>National Visa &gt; Opportunity Card</strong> &gt; Proceed to calendar page.
                    </p>
                  </div>
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs space-y-1">
                    <span className="text-indigo-400 font-bold font-mono">STEP 3</span>
                    <p className="text-slate-300">
                      <strong>Open Inspect (F12):</strong> Go to <strong>Network tab</strong> &gt; filter by{' '}
                      <code>Fetch/XHR</code> &gt; Click next month or refresh calendar.
                    </p>
                  </div>
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs space-y-1">
                    <span className="text-indigo-400 font-bold font-mono">STEP 4</span>
                    <p className="text-slate-300">
                      <strong>Copy Request URL:</strong> Find the request (e.g. <code>slots</code> or{' '}
                      <code>GetAvailableSlots</code>). Copy URL into this dashboard, or paste its response below!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Input Controls Panel */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h2 className="font-semibold text-slate-200 text-sm tracking-wide uppercase">
                Chancenkarte Monitor Configuration
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-slate-800 text-amber-300 px-2.5 py-1 rounded-full border border-amber-500/20 font-medium">
                🎯 Checking: National Visa &gt; Chancenkarte
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Center Selection */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-rose-400" />
                VFS Center
              </label>
              <select
                value={selectedCenter}
                onChange={(e) => setSelectedCenter(e.target.value)}
                disabled={isMonitoring}
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors disabled:opacity-60"
              >
                {centers.map((c) => (
                  <option key={c} value={c}>
                    {c} Center
                  </option>
                ))}
              </select>
            </div>

            {/* Subcategory Display */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-amber-400" />
                Visa Subcategory
              </label>
              <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs font-medium text-emerald-400 flex items-center justify-between">
                <span>National Visa &gt; Chancenkarte</span>
                <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded text-emerald-300">
                  Targeted
                </span>
              </div>
            </div>

            {/* Check Interval with Warning */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  Interval
                </span>
                <span className="text-[10px] text-amber-400">Min 2m recommended</span>
              </label>
              <select
                value={checkIntervalMin}
                onChange={(e) => setCheckIntervalMin(Number(e.target.value))}
                disabled={isMonitoring}
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors disabled:opacity-60"
              >
                <option value={2}>Every 2 minutes (Default)</option>
                <option value={5}>Every 5 minutes (Safer)</option>
                <option value={10}>Every 10 minutes (Relaxed)</option>
              </select>
            </div>

            {/* Detection Engine Mode */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-indigo-400" />
                Detection Method
              </label>
              <select
                value={engineMode}
                onChange={(e) =>
                  setEngineMode(e.target.value as 'simulated' | 'proxy' | 'manual_paste')
                }
                disabled={isMonitoring}
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors disabled:opacity-60"
              >
                <option value="simulated">Smart Simulator (Safe In-Browser)</option>
                <option value="manual_paste">Paste Calendar HTML / API Response</option>
                <option value="proxy">Live Internal API Request / Proxy</option>
              </select>
            </div>
          </div>

          {/* Mode-Specific Settings */}
          {engineMode === 'proxy' && (
            <div className="pt-3 border-t border-slate-800/60 space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    Internal VFS Slot API URL (from DevTools Network Tab)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    e.g. /appointment/slots or /GetAvailableSlots
                  </span>
                </label>
                <input
                  type="text"
                  value={slotApiUrl}
                  onChange={(e) => setSlotApiUrl(e.target.value)}
                  disabled={isMonitoring}
                  placeholder="https://visa.vfsglobal.com/ind/en/deu/api/appointment/slots?vacCode=HYD&visaCategoryCode=NAT_CHANCENKARTE"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 flex items-center gap-1">
                    Authorization Bearer Token / Session Header (Optional):
                  </label>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 flex items-center gap-1">
                    CORS Proxy Prefix (Bypasses Browser CORS Restrictions):
                  </label>
                  <input
                    type="text"
                    value={corsProxyUrl}
                    onChange={(e) => setCorsProxyUrl(e.target.value)}
                    placeholder="https://api.allorigins.win/raw?url="
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-300 font-mono focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Interactive Paste Calendar HTML / API Response Inspector */}
          <div className="pt-3 border-t border-slate-800/60 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-emerald-400" />
                Paste VFS Calendar HTML, Text, or Slot API JSON Response:
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadEmptyCalendarSample}
                  className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg transition-colors border border-slate-700"
                >
                  Load Sample: "No Slots" []
                </button>
                <button
                  type="button"
                  onClick={loadSlotOpenCalendarSample}
                  className="text-[11px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-lg transition-colors border border-emerald-500/30"
                >
                  Load Sample: "Slot Open" 📅
                </button>
                <button
                  type="button"
                  onClick={handleAnalyzePastedPayload}
                  className="text-[11px] bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-1 rounded-lg transition-all shadow active:scale-95 flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  Analyze / Test Payload Now
                </button>
              </div>
            </div>

            <textarea
              rows={3}
              value={pastedPayload}
              onChange={(e) => setPastedPayload(e.target.value)}
              placeholder="Paste JSON API response (e.g. { availableDates: ['2026-10-15'] } or []) OR paste calendar HTML element from Inspect Element..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-emerald-300 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <p className="text-[11px] text-slate-400">
              💡 <strong>Enabled Date Logic:</strong> If the calendar response is an empty array{' '}
              <code className="text-rose-400">[]</code> or has all dates disabled, it flags{' '}
              <strong>"No Slots"</strong>. When it contains enabled dates like{' '}
              <code className="text-emerald-300">["2026-10-15"]</code>, it instantly flags{' '}
              <strong>"SLOT OPEN"</strong> and triggers loud alarms!
            </p>
          </div>

          {/* Telegram Settings Collapsible */}
          <div className="pt-2 border-t border-slate-800/40">
            <details className="group">
              <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-medium text-slate-300 hover:text-white transition-colors">
                <span className="flex items-center gap-2">
                  <Send className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Telegram Mobile Notifications (Optional - Receive phone alerts)</span>
                </span>
                <span className="text-slate-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>

              <div className="mt-3 pt-3 border-t border-slate-800/40 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-5 space-y-1">
                  <label className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Telegram Bot Token</span>
                    <span className="text-[10px] text-slate-500">From @BotFather</span>
                  </label>
                  <input
                    type="password"
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none"
                  />
                </div>

                <div className="md:col-span-4 space-y-1">
                  <label className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Chat ID</span>
                    <span className="text-[10px] text-slate-500">From @userinfobot</span>
                  </label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="e.g. 987654321"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none"
                  />
                </div>

                <div className="md:col-span-3">
                  <button
                    type="button"
                    onClick={handleTestTelegram}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold py-2 px-3 rounded-xl transition-colors flex items-center justify-center gap-1.5 active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Test Telegram Ping
                  </button>
                </div>

                {telegramStatus.msg && (
                  <div
                    className={`md:col-span-12 text-xs px-3 py-1.5 rounded-lg ${
                      telegramStatus.type === 'success'
                        ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {telegramStatus.msg}
                  </div>
                )}
              </div>
            </details>
          </div>
        </section>

        {/* Main Dashboard Status Cards */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Big Status Card */}
          <div
            className={`lg:col-span-2 rounded-2xl border p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden transition-all duration-500 shadow-2xl ${
              status === 'slot_open'
                ? 'bg-gradient-to-br from-emerald-950/90 via-slate-900 to-emerald-900/60 border-emerald-400 glow-green flash-alert'
                : status === 'rate_limited'
                ? 'bg-gradient-to-br from-amber-950/40 via-slate-900 to-amber-900/20 border-amber-500/50'
                : status === 'checking'
                ? 'bg-gradient-to-br from-cyan-950/40 via-slate-900 to-blue-950/30 border-cyan-500/50'
                : isMonitoring
                ? 'bg-gradient-to-br from-rose-950/40 via-slate-900 to-slate-950 border-rose-500/40 glow-red'
                : 'bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border-slate-800'
            }`}
          >
            <div>
              {/* Header Status Pills */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      status === 'slot_open'
                        ? 'bg-emerald-500 text-slate-950'
                        : status === 'rate_limited'
                        ? 'bg-amber-500 text-slate-950'
                        : isMonitoring
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        status === 'slot_open'
                          ? 'bg-slate-950 animate-ping'
                          : isMonitoring
                          ? 'bg-rose-400 animate-pulse'
                          : 'bg-slate-500'
                      }`}
                    />
                    {status === 'slot_open'
                      ? 'SLOT DETECTED'
                      : status === 'rate_limited'
                      ? 'RATE LIMIT BACKOFF'
                      : isMonitoring
                      ? 'ACTIVE MONITOR'
                      : 'STANDBY'}
                  </span>

                  <span className="text-xs text-amber-300 font-mono bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                    Checking: <strong>National Visa &gt; Chancenkarte - {selectedCenter}</strong>
                  </span>
                </div>

                {isMonitoring && status !== 'slot_open' && (
                  <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-slate-400">Next check:</span>
                    <span className="text-cyan-300 font-bold">{formatSeconds(nextCheckSeconds)}</span>
                  </div>
                )}
              </div>

              {/* Status Message Display */}
              <div className="py-4">
                {status === 'slot_open' ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-3xl shadow-xl flex-shrink-0 animate-bounce">
                        !
                      </div>
                      <div>
                        <h3 className="text-3xl sm:text-4xl md:text-5xl font-black text-emerald-400 tracking-tight leading-none">
                          SLOT OPEN!!!
                        </h3>
                        <p className="text-xl sm:text-2xl font-bold text-white mt-1">
                          Bhai Slot Khul Gaya! Jaldi Book Karo!
                        </p>
                      </div>
                    </div>

                    {lastParsedDates.length > 0 && (
                      <div className="bg-slate-950/80 border border-emerald-500/50 p-4 rounded-xl space-y-1">
                        <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Calendar className="w-4 h-4" />
                          Enabled Appointment Dates Found:
                        </div>
                        <div className="text-lg font-mono font-bold text-white flex flex-wrap gap-2">
                          {lastParsedDates.map((d, i) => (
                            <span
                              key={i}
                              className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-0.5 rounded-lg"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-emerald-200/90 text-sm">
                      Opportunity Card slot confirmed for <strong>{selectedCenter}</strong>. Have your CSP file number ready and complete your booking on VFS!
                    </p>
                  </div>
                ) : status === 'checking' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin" />
                      <div>
                        <h3 className="text-2xl sm:text-3xl font-bold text-cyan-300">
                          Checking Calendar Slots...
                        </h3>
                        <p className="text-slate-400 text-sm font-mono">
                          Checking: National Visa &gt; Chancenkarte - {selectedCenter}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : status === 'rate_limited' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-10 h-10 text-amber-400" />
                      <div>
                        <h3 className="text-2xl sm:text-3xl font-bold text-amber-300">
                          Rate Limit (HTTP 429) Shield
                        </h3>
                        <p className="text-amber-200/80 text-sm">
                          Exponential backoff active. Cooling down before querying again to protect your IP.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : isMonitoring ? (
                  <div className="space-y-2">
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-black text-rose-400 tracking-tight">
                      No Slots Available
                    </h3>
                    <p className="text-slate-300 text-sm">
                      Checking: <span className="text-amber-300 font-mono">National Visa &gt; Chancenkarte - {selectedCenter}</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {lastCheckedTime ? (
                        <>
                          Last checked at <strong className="text-white">{lastCheckedTime}</strong>. Total checks:{' '}
                          <strong>{checkCount}</strong>. (API returned empty date array [])
                        </>
                      ) : (
                        'Awaiting first check...'
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <h3 className="text-2xl sm:text-3xl font-bold text-slate-300">
                      Chancenkarte Monitor Standby
                    </h3>
                    <p className="text-slate-400 text-sm">
                      Target category: <strong>National Visa &gt; Chancenkarte ({selectedCenter})</strong>. Press Start Monitoring or paste a calendar response to test.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-6 mt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleMonitoring}
                  className={`px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-lg active:scale-95 ${
                    isMonitoring
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-900/30'
                  }`}
                >
                  {isMonitoring ? (
                    <>
                      <Square className="w-4 h-4 fill-current" />
                      Stop Monitoring
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      Start Monitoring
                    </>
                  )}
                </button>

                {isMonitoring && (
                  <button
                    onClick={() => performCheck()}
                    disabled={status === 'checking'}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${status === 'checking' ? 'animate-spin' : ''}`} />
                    Check Now
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSimulateSlotFound}
                  className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3.5 py-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
                  title="Simulate slot open right now"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Simulate Slot Open (Test)
                </button>

                <a
                  href="https://visa.vfsglobal.com/ind/en/deu/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all"
                >
                  <span>Open VFS</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>

          {/* Right Status Beacon & Indicator */}
          <div className="space-y-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden shadow-xl">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                Live Status Beacon
              </div>

              <div className="relative my-4 flex items-center justify-center">
                <div
                  className={`w-32 h-32 rounded-full absolute transition-all duration-700 ${
                    status === 'slot_open'
                      ? 'bg-emerald-500/20 animate-ping'
                      : isMonitoring
                      ? 'bg-rose-500/10 animate-pulse'
                      : 'bg-slate-800/40'
                  }`}
                />
                <div
                  className={`w-24 h-24 rounded-full absolute border ${
                    status === 'slot_open'
                      ? 'border-emerald-400/50 animate-pulse'
                      : isMonitoring
                      ? 'border-rose-500/30'
                      : 'border-slate-700'
                  }`}
                />

                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl relative z-10 transition-all duration-300 ${
                    status === 'slot_open'
                      ? 'bg-emerald-500 shadow-emerald-500/80 ring-8 ring-emerald-500/30'
                      : status === 'rate_limited'
                      ? 'bg-amber-500 shadow-amber-500/50 ring-4 ring-amber-500/20'
                      : isMonitoring
                      ? 'bg-rose-600 shadow-rose-600/50 ring-4 ring-rose-600/20'
                      : 'bg-slate-700 shadow-none'
                  }`}
                >
                  {status === 'slot_open' ? (
                    <Flame className="w-8 h-8 text-slate-950 animate-bounce" />
                  ) : status === 'checking' ? (
                    <RefreshCw className="w-7 h-7 text-white animate-spin" />
                  ) : isMonitoring ? (
                    <span className="w-4 h-4 rounded-full bg-white animate-ping" />
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-slate-400" />
                  )}
                </div>
              </div>

              <div className="mt-2">
                <div className="font-bold text-sm text-slate-200">
                  {status === 'slot_open'
                    ? '🟢 GREEN LIGHT: CHANCENKARTE OPEN'
                    : isMonitoring
                    ? '🔴 RED LIGHT: NO SLOTS'
                    : '⚪ STANDBY MODE'}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Target: National Visa &gt; Chancenkarte ({selectedCenter})
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Total Scans</div>
                <div className="text-xl font-mono font-bold text-white mt-0.5">{checkCount}</div>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Rate Limits</div>
                <div className="text-xl font-mono font-bold text-amber-400 mt-0.5">
                  {consecutiveRateLimits > 0 ? `${consecutiveRateLimits} hits` : '0 (Safe)'}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Live Check Logs Audit Table */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400" />
              <h3 className="font-semibold text-slate-200 text-sm uppercase tracking-wide">
                Live Audit Logs ({logs.length})
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                Log shows exact category: <code>Checking: National Visa &gt; Chancenkarte - [City]</code>
              </span>
              <button
                onClick={() => setLogs([])}
                className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Clear Logs
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-semibold">Timestamp</th>
                  <th className="py-2.5 px-3 font-semibold">Category & Center Checked</th>
                  <th className="py-2.5 px-3 font-semibold">Status Result</th>
                  <th className="py-2.5 px-3 font-semibold">Dates / Result Details</th>
                  <th className="py-2.5 px-3 font-semibold">HTTP Code</th>
                  <th className="py-2.5 px-3 font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-sans text-xs">
                      No logs recorded yet. Start monitoring or click "Analyze / Test Payload Now" above.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className={`hover:bg-slate-800/30 transition-colors ${
                        log.status === 'slot_open' ? 'bg-emerald-950/40 text-emerald-300 font-bold' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                        [{log.timestamp}]
                      </td>
                      <td className="py-2.5 px-3 text-amber-300 font-mono font-medium whitespace-nowrap">
                        Checking: {log.category}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {log.status === 'slot_open' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                            🟢 SLOT OPEN
                          </span>
                        ) : log.status === 'rate_limited' ? (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                            🟡 RATE LIMITED (429)
                          </span>
                        ) : log.status === 'error' ? (
                          <span className="inline-flex items-center gap-1 text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">
                            ⚠️ ERROR
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded">
                            🔴 No Slots
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-sans">
                        {log.detectedDates && log.detectedDates.length > 0 ? (
                          <span className="text-emerald-300 font-bold font-mono">
                            📅 {log.detectedDates.join(', ')}
                          </span>
                        ) : (
                          log.message
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {log.httpCode ? `HTTP ${log.httpCode}` : 'INSPECT'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{log.durationMs}ms</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Disclaimer */}
        <footer className="mt-8 pt-6 pb-10 border-t border-slate-800 text-center text-xs text-slate-400 space-y-2">
          <div className="flex items-center justify-center gap-1.5 text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-slate-300">VFS Terms & Anti-Ban Policy Compliance</span>
          </div>
          <p className="max-w-3xl mx-auto text-slate-400 leading-relaxed">
            This is only an alert tool. It does not auto-book appointments and respects VFS rate limits. Auto-booking bots can get your account banned.
          </p>
          <p className="text-[11px] text-slate-500">
            Consular Service Portal (CSP) pre-approval is required before Opportunity Card (Chancenkarte) slots can be confirmed at VFS Global India.
          </p>
        </footer>
      </main>
    </div>
  );
}
