---
title: Attention Is All You Need
date: "2025-10"
description: Transformer 架构原论文，自注意力取代循环网络
pdf: https://arxiv.org/pdf/1706.03762
---

## 核心创新

自注意力机制（Self-Attention）允许序列中任意两个位置直接交互，解决了 RNN 的长程依赖问题。Multi-Head Attention 让模型在不同子空间中学习不同类型的注意力关系。

## 位置编码

由于注意力机制本身不感知位置，模型通过在输入中加入正弦/余弦位置编码提供位置信息。

## 架构细节

编码器-解码器结构，每层包含 Multi-Head Attention + Feed-Forward Network，通过残差连接和层归一化稳定训练。
