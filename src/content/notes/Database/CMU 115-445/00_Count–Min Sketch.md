---
title: 01 Count-Min Sketch
date: "2026-04-24"
tags: [count-min, cmu, cpp]
reading_time: 20 min
---
## Introduction

>Consider the following scenario: you are the administrator of a popular blog website, and you've been receiving reports on certain accounting spamming excessively. To map out overall network usage and detect potential DDoS attacks, you want a real-time approach to count how often each IP address appears in the incoming request stream. However, the stream is huge, which makes traditional data structures either too slow or too memory-hungry. This is where the **Count–Min Sketch** comes in!

对于实时统计每个 IP 地址在请求流中的出现频率，关于统计一类，通常我们习惯使用哈希表来提高查询效率，然而很显然，在该情况下，倘若直接使用哈希表，会出现以下几个问题
* 内存占用线性增长，每增加一个IP，都需要额外分配一个哈希表节点。
* 缓存局部性差，由于哈希表的优点是无序，在少量访问时，对于随机访问的效率整体上是很可观的。可是当数据频繁访问，修改，以及遍历时，无序的缺点就慢慢显现了，内存上无序的代价，当然是CPU缓存糟糕。
* 多线程同步成本高，哈希表作为一个整体，在并发环境上为了保护数据而加锁，想要分片进行加锁操作提升效率是很难实现的，而如果不解决这个问题，随着并发量增大，很快就会达到性能瓶颈，这点在CMS中也是相当重要的。

## Solution

### CMS 数据结构

考虑到哈希的优点非常多，而直接使用哈希表的核心问题在于整体过于臃肿。于是我们希望能够把问题拆散。

首先需要解决内存占用问题，很经典的操作系统中的**多级页表**的思路可以很好的解决，即使用$2^9 + 2^9 + 2^9$的内存占用，表示$2^{27}$ 的范围

至于解决缓存局部性差的问题，关键在于，我们既想享有哈希函数的查找优势，又希望内存上能够拥像数组一样整齐排列。其实舍弃哈希表的通用性就能很好的解决这个问题，换句话说，哈希表的设计实现上倘若不做任何辅助优化，就是这样的结构：通过哈希函数将任意输入映射成数组下标。

映射后的数组点位，下标失去了其原本的顺序意义，于是换了个称呼，在哈希表里我们称之为**桶**(bucket)。由于桶是有限的，不可避免的存在两个不同的输入，经过哈希映射后，会分配到一个相同的桶，这就是**哈希碰撞**。

传统上解决**哈希碰撞**是将桶作为一个结构，接着纵向拓展以保存桶内的不同数据。实现上可以是链表，也可以是数组，各有优缺。当我们很好的权衡了空间与时间上的关系后，妥善处理了哈希碰撞，我们就设计出了一个很优秀的通用性的哈希表。

回到上述，这不是我们想要的，因此结合了**多级页表**的思路，CMS中，维护的是一个 **`depth × width` 的计数矩阵**
* `depth = d`：行数，对应 **d 个独立哈希函数**；
* `width = w`：列数，每个哈希把元素映射到 `[0, w-1]` 中的一个桶；

当然为了存储效率，必要时可以将二维表摊平成一维表。

有了这个数据结构，仅仅使用了$d*w$ 的内存占用，就几乎能够表示$d^w$ 的范围，而且还能够很好的利用数据内存分布优势。

权衡好d与w的具体数值和关系，当然也很重要，`width` 越大，每行桶越多，碰撞概率下降，绝对误差越小。`depth` 越大，拥有越多独立的“估计上界”，所有行都严重碰撞的概率越小；在理论上，`w` 和 `d` 可以和目标误差 `ε`、置信度 `δ` 联系起来，但在项目中我们主要是理解其直觉与实现方法。这里不作深入了解。

### CMS 接口设计

* `void Insert(const KeyType &item);`
	* 给定一个目标IP，遍历所有depth函数，计算目标得到目标桶 `col = hash_fun[d_i](item)`,  `sketch[d_i][col]++`。
* `auto Count(const KeyType &item) const -> uint32_t;`
	* 对于需要查询的IP，遍历所有depth函数，获取目标桶 `col = hash_fun[d_i](item)`，取最小值作为统计数。
* `void Merge(const CountMinSketch<KeyType> &other);`
	* 对于两个 CMS：`A` 和 `B`，并且两者的 `width`、`depth` 完全相同，且使用的哈希函数族 / seed 配置也一致，那么合并后`C`理应存在关系`C[i][j] = A[i][j] + B[i][j]`

### 应用意义
* 在分布式系统中，每个节点可以本地维护一个 CMS；
- 上报时只需把矩阵按元素相加即可合并；
- 不需要传输完整原始数据流，也不用维护巨大的哈希表。

这对于网络流量监控、日志分析、数据库优化等场景都非常重要。

## Code

代码实现主要讨论多线程同步问题，在CMS的结构中，哈希表可以理解为被拆分成了d个小表，以小表的颗粒度进行锁操作，可以很大程度提高效率。

核心接口的计数操作，可视为只读，并不存在数据竞态，不做特殊考虑。

对于插入和合并操作，保证数据的线程安全是很有必要的。

在C++中实现多线程并发控制，std标准库中给出了很多解决方案。

* `std::mutex` 通过 **互斥锁** 保护一整段临界区代码，同时只有一个线程可以进入
* `std::atomic` 基于 **CPU 的原子指令**，在**单个变量层面**保证读写和更新不可被打断

假定我们存在维护的`sketch`结构为二维维表 `std::vector<std::vector<uint32_t>> sketch`, 以及一个对应d长度的互斥锁列表`std::mutex counter_mutex[]`;

对于插入操作使用mutex，mutex非常简单，并且提供了类似`go`中`defer`的安全释放，使用`std::lock_guard<std::mutex> lock()` 请求锁，`std::lock_guard`是典型的RAII 封装，构造时`lock`， 析构时`unlock`。
```c++
template <typename KeyType>
void CountMinSketch<KeyType>::Insert(const KeyType &item) {
  for(size_t i = 0; i < depth_; i++){
	size_t col = hash_functions_[i](item);
	std::lock_guard<std::mutex> lock(counter_mutex[i]);
	sketch[i][col]++;
  }
}
```

合并操作类似
```c++
template <typename KeyType>
void CountMinSketch<KeyType>::Merge(const CountMinSketch<KeyType> &other) {
  if (width_ != other.width_ || depth_ != other.depth_) {
    throw std::invalid_argument("Incompatible CountMinSketch dimensions for merge.");
  }
  for(size_t i = 0; i < depth_; i++){
	  std::lock_guard<std::mutex> lock(counter_mutex[i]);
	  for (size_t j = 0; j < width_; j++){
		  sketch_[i][j] += other.sketch_[i][j];
	  }
  }
}
```

由于CMS中的操作结构上就是一个简单的一维或者二维表，因此更简单高效的方式是不用锁，使用`std::atomic` 即可，而且更贴合结构，颗粒度更精细。

假定我们存在维护的`sketch`结构为摊平的一维表 `std::atomic<uint32_t>[] sketch_`

`std::atomic` 操作数据的常见函数有
```c++
// RMW 算术 / 位运算
T fetch_add(T arg,
            std::memory_order order = std::memory_order_relaxed /* 常用 */) noexcept;
T fetch_sub(T arg,
            std::memory_order order = std::memory_order_relaxed) noexcept;
T fetch_and(T arg,
            std::memory_order order = std::memory_order_relaxed) noexcept;
T fetch_or(T arg,
           std::memory_order order = std::memory_order_relaxed) noexcept;
T fetch_xor(T arg,
            std::memory_order order = std::memory_order_relaxed) noexcept;

// 读 / 写
T load(std::memory_order order = std::memory_order_seq_cst) const noexcept;
void store(T desired,
           std::memory_order order = std::memory_order_seq_cst) noexcept;
```

`std::memory_order` 参数控制**编译器和 CPU 能不能把某些内存操作重排**，以及“别的线程什么时候能看到这些写入”。

常见值如下：
- `std::memory_order_relaxed` 只保证这一次原子操作本身是原子的，不对前后其它普通读写顺序做额外约束
- `std::memory_order_acquire` 使用acquire标记读操作，确保release标记的写操作一定在读操作之前，保证顺序关系。
- `std::memory_order_release`
- `std::memory_order_acq_rel`
- `std::memory_order_seq_cst`（默认）使所有原子操作看起来像**按某个全局顺序**执行

插入操作
```c++
template <typename KeyType>
void CountMinSketch<KeyType>::Insert(const KeyType &item) {
  for(size_t i = 0; i < depth_; i++){
    size_t col = hash_functions_[i](item);
    sketch_[Pos(i, col)].fetch_add(1, std::memory_order_relaxed);
  }
}
```

合并操作
```c++
template <typename KeyType>
void CountMinSketch<KeyType>::Merge(const CountMinSketch<KeyType> &other) {
  if (width_ != other.width_ || depth_ != other.depth_) {
    throw std::invalid_argument("Incompatible CountMinSketch dimensions for merge.");
  }
  size_t total = width_ * depth_;
  for (size_t i = 0; i < total; i++) {
    sketch_[i].fetch_add(other.sketch_[i].load(std::memory_order_relaxed),
                         std::memory_order_relaxed);
  }
}
```