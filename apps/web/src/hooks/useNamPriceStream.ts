"use client";

import { useEffect, useRef, useState } from "react";
import { useSocket } from "./useSocket";
import { fetchApi } from "@/lib/api";

export type NamPricePoint = { ts: string; priceUsd: string };

export type NamPriceState = {
  price: number | null;
  iconUrl: string | null;
  lastUpdatedAt: string | null;
  history: NamPricePoint[];
};

type NamPriceResponse = {
  priceUsd: string;
  tokenIconUrl?: string | null;
  lastUpdatedAt?: string;
  history: NamPricePoint[];
};

const EMPTY_STATE: NamPriceState = {
  price: null,
  iconUrl: null,
  lastUpdatedAt: null,
  history: [],
};

export function useNamPriceStream(): NamPriceState {
  const { socket, connected } = useSocket();
  const [state, setState] = useState<NamPriceState>(EMPTY_STATE);
  const bootstrapped = useRef(false);

  // Bootstrap from HTTP on first render so the chart isn't empty
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    fetchApi<NamPriceResponse>("/markets/nam-price")
      .then((data) => {
        const price = Number(data.priceUsd);
        if (!Number.isFinite(price)) return;
        setState({
          price,
          iconUrl: data.tokenIconUrl ?? null,
          lastUpdatedAt: data.lastUpdatedAt ?? null,
          history: data.history ?? [],
        });
      })
      .catch(() => {
        // Silent - WebSocket updates will populate state shortly
      });
  }, []);

  // Live WebSocket updates from the backend poller
  useEffect(() => {
    if (!socket || !connected) return;

    const handleNamPrice = (data: NamPriceResponse) => {
      const price = Number(data.priceUsd);
      if (!Number.isFinite(price)) return;
      setState({
        price,
        iconUrl: data.tokenIconUrl ?? null,
        lastUpdatedAt: data.lastUpdatedAt ?? null,
        history: data.history ?? [],
      });
    };

    socket.on("nam:price", handleNamPrice);
    return () => {
      socket.off("nam:price", handleNamPrice);
    };
  }, [socket, connected]);

  return state;
}
