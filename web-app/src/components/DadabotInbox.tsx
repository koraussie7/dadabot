import React, { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

export interface DadabotChangeRequest {
  id: string;
  title: string;
  rationale: string;
  category: string;
  confidence: number;
  autonomyLevel: number;
  reversible: boolean;
  touchesProtected: boolean;
  permission: "read" | "changeRequest" | "autoMerge";
  createdAt: string;
  proposedBy: string;
}