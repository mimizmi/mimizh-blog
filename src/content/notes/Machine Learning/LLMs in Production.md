
尽管世界上有许多前沿的ai科技公司为我们提供强大的model api，但是使用商业的api仍然存在很多限制(在ai model日渐智能的今天，人类使用的安全边界成了首要问题)，尤其是制作深度结合ai的产品中，自己学习自行设计和部署自己的模型仍然具备很大的价值。两者之间各有优劣，都不可忽视，前言科技公司的模型讲究广度目标是AGI，自我设计的模型讲究深度目标是产品。

第一款比较知名的ai应用开发产品是一个ai驱动的rpg游戏，由Latitude公司开发，很不幸的是结果并不太好，但是给了我们很多学习和反思的经验。[Latitude](https://arstechnica.com/gaming/2021/05/it-began-as-an-ai-fueled-dungeon-game-then-it-got-much-darker/) [Before LLM(IBM Watson)](https://mng.bz/JZ9Q)

> Ultimately, **control** is the first thing that’s lost when you buy someone else’s product. Keeping control will give you more options to solve future problems and will also give you a competitive edge.


### Language modeling

#### Linguistic features

在深入了解大语言模型的数学表示前，我们理应先花点时间厘清这个源远流长的“语言”本质。

理解语言大致可以分为以下几个方向：
* phonetics
	* 说起来语言是将抽象的概念具象化的表现，“语音”相比其他几部分，是最不抽象的表示，因为声音本身具有实际的载体，而不是人为抽象的概念。因此哪怕是超级跨物种，人与机器间使用声音交流，转化起来也十分自然(声音转化电信号、数字信号)然而在实际使用中，由于声音本身是自由客观的，在主观使用中不同的人，不同的语言，赋予声音不同的意义，导致情况变得远比其他几部分更加复杂。
* syntax
	* 句法在这里是词序与语法的结合，区别于语义，用于验证句子组成结构的正确性，也是大语言模型现在应用最好的方向，LLM现在可以生成非常正确的句子，尽管有时候语义让人感到迷惑和混乱。
* semantics
	* 句法是使用语言的规定，而语义才是语言的本质含义，当然是极其抽象的，在现在的数字脑中，比较贴合的是embedding，是对字符抽象的数字表示，在大量文本的相同语义查询中，有比较好的表现。但是词的语义的变化和衍生是相当复杂而且动态的，随着时间的推移，语言的使用者仍然会不断衍生新的语义。为了让数字脑方便理解，目前比较常见的做法是word embedding的过程，大致为从语料中汇总定义一个庞大的词典，这个过程称之为tokenizing，接着用多维度的vector在数字空间表示和理解。尽管embedding的表示方式有时候很好，但是并非维度越高效果越好，而且有时会发现表意无关的语词或者句子间居然能通过计算有很强相关性，或许这是数字脑理解中人类不能发现的地方，但是就人类使用而言，这是一个错误和不足的表现，如何更全面的捕捉并表达语义，是未来值得期待突破性研究的另一个领域。
* pragmatics
	* 语用学是语义更加具象化的表现，依赖于上下文和语境，也许可以说是“多语义”组成的研究学问。在LLM中，这一部分更多关于是模型使用中上下文的管理学问，早期比较热门的方式是RAG以及针对指令数据集对模型进行额外监督微调。换句话说，前几个部分已经足够构成一个非常智能强大的数字脑了，但是这个数字脑也许太中庸了，也许太欠缺经验了，这一部分即是专精特定的使用场景和知识体系。也许AGI的的真正实现，需要的正是将这一部分更好的纳入数字脑体系当中，现在看来这一部分更多是依赖人为的辅助和设计。
	> Pragmatics and context all revolve around entailment. An entailment is a prag- matic marker within your data, as opposed to the literal text your dataset contains. For example, let’s say you have a model attempting to take an input like “Write me a speech about frogs eating soggy socks that doesn’t rhyme and where the first letters of each line spell amphibian” and actually follow that instruction. You can immediately tell that this input is asking for a lot. The balance for you as a data engineer would be to make sure that everything the input is asking for is explicitly accounted for in your data. You need examples of speeches, examples of what frogs and socks are and how they behave, and examples of acrostic poems. If you don’t have them, the model might be able to understand just from whatever entailments exist in your dataset, but it’s pretty up in the air.

	* 现在的大语言模型很难完全掌握语用学，在存在更好的技术突破以前，现在大语言仅仅是能做到掌握普通人基本的语用，在特定领域想要得到超出普通级别的专家级回答，且有比较稳定的效果依赖恰到好处的提示词刺激，譬如在图像生成中“masterpiece”一词通常可以激发模型生成质量更高的图像，但前提是训练集中存在这种entailment(蕴含关系)，然而就像训练时不可能涵盖所有可能的情形，提示词工程的能力也因此而存在瓶颈，但仍然已经具备相当高的实用性价值了。因此提示词工程，以及现在热门的skills体系在模型技术对理解语用有进一步突破以前，确实是在应用中最合适深入研究且收效最高的方向。
	>After training, you can coax particular information from your model through prompting, which has a skill ceiling based on what your data originally entailed.
	
* morphology
	* 如果说语用是语义在多上下文中的扩展研究，那么形态学就是语义的进一步细化研究，譬如英文中的词根词缀，中文中的偏旁部首，编程语言中的有效syntax定义等等，他们是词表意的最小字符单位。这一步的意义可以从人类学习语言的过程进行感受，理解词根词缀的含义，有助于我们更好的面对未知的词语，同时对于该语言的符号构成体系的底层逻辑也会有更加深入的理解。在tokenization中morphology也是辅助文本有效拆分成token的依据。

#### Semiotics

在探讨语言的基本特征，并考察它们在大型语言模型背景下的意义之后，重要的是从更广阔(更抽象化)的视角来思考人类交流中的意义建构与阐释。符号学——对符号和象征的研究——提供了一个有价值的视角，帮助我们更好地理解人们如何阐释和处理语言。我们将深入探讨符号学，考察符号、能指与抽象概念之间的关系，以及大型语言模型如何利用这些元素生成有意义的输出。这番讨论将加深我们对复杂过程的理解：大型语言模型如何设法模仿人类对语言的理解，同时也揭示它们在这一过程中面临的挑战与局限。我们并不一定认为模仿人类行为是改进大型语言模型的正确方向；我们只是认为，迄今为止，这个领域一直以模仿来评估自身。

> This discussion will provide a deeper understanding of the intricate processes through which LLMs manage to mimic human-like understanding of language while also shedding light on the challenges and limitations they face in this endeavor. We do not necessarily believe that mimicking human behavior is the right answer for LLM improvement, only that mimicry is how the field has evaluated itself so far.

![](assets/LLMs%20in%20Production/file-20261107161727686.png)

![](assets/LLMs%20in%20Production/file-20261108100144669.png)

上图两个Peircean符号学三角形，大致阐述了人是怎么通过符号将一个抽象的想法表达出来以供旁人理解的。

#### Multilingual NLP

#### Language modeling techniques

技术上对抽象语言(NLP)的建模有很多种方式，各自有其的优缺点和局限性

##### 定义token以及处理input （**统计语言模型**）

> bag-of-words(BoW)， it consists of simply counting words as they appear in text.


```python
	setence = "What is a bag of words and what does it for me when processing words?"
	clean_text = sentence.lower().split(" ")
	bow = {word:clean_text.count(word) for word in clean_text}
	print(bow)
	# {'what': 2, 'is': 1, 'a': 1, 'bag': 1, ..., 'words?': 1}
```

尽管这个方式的缺点显而易见：不具备图像、语义、语用、短语或情感表述能力，而且分词方式过于简单，同样无法处理形态学，但是就文本的关键词分析而言，仍然具备一定的实用性。这是一种弱语言表示模型。为了解决词袋模型无法捕捉序列数据的问题，人们提出了 N 元语法模型。

##### N-gram and corpus-based techniques

 N-gram 模型和核心是马尔可夫假设，表示一个词的出现只与它前面的N-1个词有关。
$$
P(w_1, w_2, \dots, w_m) = \prod_{i=1}^{m} P(w_i \mid w_{i-N+1}, \dots, w_{i-1})
$$

|      模型       |                   公式                    |       直觉        |
| :-----------: | :-------------------------------------: | :-------------: |
| Unigram (N=1) |                $P(w_i)$                 | 词与词独立，只看词频，即BoW |
| Bigram (N=2)  |          $P(w_i \mid w_{i-1})$          |     只看前一个词      |
| Trigram (N=3) |     $P(w_i \mid w_{i-2}, w_{i-1})$      |      看前两个词      |
|    N-gram     | $P(w_i \mid w_{i-N+1}, \dots, w_{i-1})$ |    看前 N-1 个词    |

计算使用极大似然估计(MLE)
$$
P(w_i \mid w_{i-1}) = \frac{\text{count}(w_{i-1}, w_i)}{\text{count}(w_{i-1})}
$$
即：**"上一个词是 A 时下一个词是 B" 的次数 ÷ "上一个词是 A" 的总次数**，但由于分子是组合出现的次数，倘若语料中不存在某组合，会导致整个句子的概率变为0，因此需要适当平滑
- **Add-1 (Laplace) 平滑**：分子 +1，分母 +V（词表大小）
- **Add-k 平滑**：加 k
- **Kneser-Ney 平滑**：更高级，效果好

代码实现可见[^1]
``` python
# listing_2.2.naive_bayes.py
from utils import process_utt
from utils import lookup
from nltk.corpus.reader import PlaintextCorpusReader
import numpy as np

my_corpus = PlaintextCorpusReader("./", ".*\.txt")

sents = my_corpus.sents(fileids="./data/hamlet.txt")


def count_utts(result, utts, ys):
    """
    Input:
        result: a dictionary that is used to map each pair to its frequency
        utts: a list of utts
        ys: a list of the sentiment of each utt (either 0 or 1)
    Output:
        result: a dictionary mapping each pair to its frequency
    """

    for y, utt in zip(ys, utts):
        for word in process_utt(utt):
            # define the key, which is the word and label tuple
            pair = (word, y)

            # if the key exists in the dictionary, increment the count
            if pair in result:
                result[pair] += 1

            # if the key is new, add it to the dict and set the count to 1
            else:
                result[pair] = 1

    return result


result = {}
utts = [" ".join(sent) for sent in sents]
ys = [sent.count("be") > 0 for sent in sents]
count_utts(result, utts, ys)

freqs = count_utts({}, utts, ys)
lookup(freqs, "be", True)
for k, v in freqs.items():
    if "be" in k:
        print(f"{k}:{v}")


def train_naive_bayes(freqs, train_x, train_y):
    """
    Input:
        freqs: dictionary from (word, label) to how often the word appears
        train_x: a list of utts
        train_y: a list of labels correponding to the utts (0,1)
    Output:
        logprior: the log prior.
        loglikelihood: the log likelihood of you Naive bayes equation.
    """
    loglikelihood = {}
    logprior = 0

    # calculate V, the number of unique words in the vocabulary
    vocab = set([pair[0] for pair in freqs.keys()])
    V = len(vocab)

    # calculate N_pos and N_neg
    N_pos = N_neg = 0
    for pair in freqs.keys():
        # if the label is positive (greater than zero)
        if pair[1] > 0:
            # Increment the number of positive words (word, label)
            N_pos += lookup(freqs, pair[0], True)

        # else, the label is negative
        else:
            # increment the number of negative words (word,label)
            N_neg += lookup(freqs, pair[0], False)

    # Calculate D, the number of documents
    D = len(train_y)

    # Calculate the number of positive documents
    D_pos = sum(train_y)

    # Calculate the number of negative documents
    D_neg = D - D_pos

    # Calculate logprior
    logprior = np.log(D_pos) - np.log(D_neg)

    # For each word in the vocabulary...
    for word in vocab:
        # get the positive and negative frequency of the word
        freq_pos = lookup(freqs, word, 1)
        freq_neg = lookup(freqs, word, 0)

        # calculate the probability that each word is positive, and negative
        p_w_pos = (freq_pos + 1) / (N_pos + V)
        p_w_neg = (freq_neg + 1) / (N_neg + V)

        # calculate the log likelihood of the word
        loglikelihood[word] = np.log(p_w_pos / p_w_neg)

    return logprior, loglikelihood


def naive_bayes_predict(utt, logprior, loglikelihood):
    """
    Input:
        utt: a string
        logprior: a number
        loglikelihood: a dictionary of words mapping to numbers
    Output:
        p: the sum of all the logliklihoods + logprior
    """
    # process the utt to get a list of words
    word_l = process_utt(utt)

    # initialize probability to zero
    p = 0

    # add the logprior
    p += logprior

    for word in word_l:
        # check if the word exists in the loglikelihood dictionary
        if word in loglikelihood:
            # add the log likelihood of that word to the probability
            p += loglikelihood[word]

    return p


def test_naive_bayes(test_x, test_y, logprior, loglikelihood):
    """
    Input:
        test_x: A list of utts
        test_y: the corresponding labels for the list of utts
        logprior: the logprior
        loglikelihood: a dictionary with the loglikelihoods for each word
    Output:
        accuracy: (# of utts classified correctly)/(total # of utts)
    """
    accuracy = 0  # return this properly

    y_hats = []
    for utt in test_x:
        # if the prediction is > 0
        if naive_bayes_predict(utt, logprior, loglikelihood) > 0:
            # the predicted class is 1
            y_hat_i = 1
        else:
            # otherwise the predicted class is 0
            y_hat_i = 0

        # append the predicted class to the list y_hats
        y_hats.append(y_hat_i)

    # error = avg of the abs vals of the diffs between y_hats and test_y
    error = sum(
        [abs(y_hat - test) for y_hat, test in zip(y_hats, test_y)]
    ) / len(y_hats)

    # Accuracy is 1 minus the error
    accuracy = 1 - error

    return accuracy


if __name__ == "__main__":
    logprior, loglikelihood = train_naive_bayes(freqs, utts, ys)
    print(logprior)
    print(len(loglikelihood))

    my_utt = "To be or not to be, that is the question."
    p = naive_bayes_predict(my_utt, logprior, loglikelihood)
    print("The expected output is", p)

    print(
        "Naive Bayes accuracy = %0.4f"
        % (test_naive_bayes(utts, ys, logprior, loglikelihood))
    )
```

##### Bayes’ theorem

贝叶斯定理是用于描述输入空间中输出出现情况的理论之一，详细数学介绍可见**概率论**

本质上是根据先验知识计算某个事件发生的概率，数学符号表示为$P(A \mid B)$，意为“**在事件 B 发生的条件下，事件 A 发生的概率**”。该定理指出：

$$结果出现的概率 = \frac{假设结果为真时出现证据的概率 \times 该假设出现的概率} {证据为真的概率}
$$
即：
$$
P(hypothesis \mid evidence) = \frac{P(evidence \mid hypothesis) \times P(hypothesis)} {P(evidence)}
$$

or
$$
P(A \mid B) \times P(B) = P(B \mid A) \times P(A)
$$
尽管贝叶斯定理在数学上非常严谨，但是本质是判别式，用于分类器而非生成器，更加无法抽象的理解和表达语义中的随机性和多样性。通常用作与分类任务，以及作为辅助增强其他的语言模型。详细代码实现见仓库[^1]


##### Markov chains

贝叶斯模型以及BoW、N-gram 模型的最大问题在于，所有序列并不完全相连，因此Markov链促使我们转向序列建模和语言生成方向。

马尔科夫链又称**Hidden Markov Models**(HMMs)

在贝叶斯的数学基础之上，马尔可夫模型完全依赖可预测随机性(stochasticity: predictable randomness)，认为(定义)接下来发生的任何事情的概率完全取决于当前状态。因此不再是仅仅根据统计历史情况进行建模并推算概率，而是根据当前正在发生的情况来建模词语未来和过去的组合，开始有了动态的感觉，这种也称作**state**，HMMs即是N-gram模型增加隐性状态的结果。

REF[^1]: Generative hidden Markov language model implementation
```python
# listing_2.3.gen_markov_chains.py
import re
import random
from nltk.tokenize import word_tokenize
from collections import defaultdict, deque


class MarkovChain:
    def __init__(self):
        self.lookup_dict = defaultdict(list)
        self._seeded = False
        self.__seed_me()

    def __seed_me(self, rand_seed=None):
        if self._seeded is not True:
            try:
                if rand_seed is not None:
                    random.seed(rand_seed)
                else:
                    random.seed()
                self._seeded = True
            except NotImplementedError:
                self._seeded = False

    def add_document(self, str):
        preprocessed_list = self._preprocess(str)
        pairs = self.__generate_tuple_keys(preprocessed_list)
        for pair in pairs:
            self.lookup_dict[pair[0]].append(pair[1])

    def _preprocess(self, str):
        cleaned = re.sub(r"\W+", " ", str).lower()
        tokenized = word_tokenize(cleaned)
        return tokenized

    def __generate_tuple_keys(self, data):
        if len(data) < 1:
            return

        for i in range(len(data) - 1):
            yield [data[i], data[i + 1]]

    def generate_text(self, max_length=50):
        context = deque()
        output = []
        if len(self.lookup_dict) > 0:
            self.__seed_me(rand_seed=len(self.lookup_dict))
            chain_head = [list(self.lookup_dict)[0]]
            context.extend(chain_head)

            while len(output) < (max_length - 1):
                next_choices = self.lookup_dict[context[-1]]
                if len(next_choices) > 0:
                    next_word = random.choice(next_choices)
                    context.append(next_word)
                    output.append(context.popleft())
                else:
                    break
            output.extend(list(context))
        return " ".join(output)


if __name__ == "__main__":
    with open("./data/hamlet.txt", "r", encoding="utf-8") as f:
        text = f.read()
    HMM = MarkovChain()
    HMM.add_document(text)

    print(HMM.generate_text(max_length=25))
```

HMMs速度极快，常用于预测文本或预测搜索应用。

> HMMs are incredibly fast and are often used in predictive text or predictive search applications. Markov models represent the first comprehensive attempt to model language from a descriptive linguistic perspective, as opposed to a prescriptive one.

理解descriptive和prescriptive

> The difference between descriptive and prescriptive linguistics is that the latter focuses on how things ought to be, while the former focuses on how things are.

尽管Markov Model已经开始注意到从descriptive转向了prescriptive，从试图规定语言模型的运作，转向在Markov视角和语料库中观察语言的表现。但是仍然存在仅凭当前状态无法提供超越当下的语境的问题。为了解决这个，引出了 "continuous" models，以便进行 "semantic embedding"

##### Continuous language modeling

>This is the first language modeling technique we’ll see that essentially slides a context window over a given utterance (the context window is an N-gram model) and attempts to guess the word in the middle based on the surrounding words in the window.

Continuous bag of words
```python

```

//等待补充p46-71

### Large language model operations: Building a platform for LLMs

#### LLMOps essentials

#### compression

我们总是希望模型的参数越高、GPU越强，内存越大。但是出于多方考虑，实际使用中，不可避免的希望在尽量保证模型能力的前提下，能够使用比较小的资源占用，下面是一些关于解决这个问题的一些方案，各有优缺点。

##### Quantizing

也就是熟知的“量化”。

> Quantizing is the process of reducing precision in preference of lowering the memory requirements.

这种取舍是合理的，我们通常在计算机中通过浮点数表示数字时，常常实际的精读远超于我们所需要的，譬如在python中使用`0.1 + 0.2`，结果并不等于`0.3`, 而很可能是`0.3000000000004`，通过降低一定的精读，增加误差范围，但是换取更低的资源消耗，对我们而言是值得的

32bits的浮点型被称作全精度，通常基础的量化就是将全精度转化为半精度，使得模型缩小为原来的一半，常见的半精度标准有FP16，BF16，其中BF16使用的指数数量与FP32相同，人们因此发现它更适合量化。
![](assets/LLMs%20in%20Production/file-20261110161445138.png)

通常还能进一步压缩，使用8bits进行量化。

量化非常容易实现，下面是使用PyTorch量化库进行简单的post-training static quantization(PTQ).
```python
#

```


静态后训练量化(PTQ)是最简单直接的量化方法，但正如其名，是在模型训练完成后进行的，并对所有模型参数进行均匀量化。这种最直接的方式代价就是误差会稍微大一些。实际的量化方法有很多选择，诸如：均匀量化与非均匀量化、静态量化与动态量化、对称量化与非对称量化，以及在训练期间或训练之后应用量化。

> Some methods to consider are uniform versus nonuniform, static versus dynamic, symmetric versus asymmetric, and applying it during or after training.


> [!NOTE] Quantization methods
> - Uniform versus non-uniform
> 	- Whether we use an 8-bit standard that is uniform in that range it represents or non-uniform to be more precise in the -1 to 1 range.
> - Static versus dynamic
> 	- Choosing to adjust the range or scale before clipping in an attempt to reduce clipping and rounding errors and reduce data loss.
> - Symmetric versus asymmetric
> 	- Normalizing the data to be normal and force symmetry or choosing to keep any asymmetry and skew.
> - During or after training
> 	- Quantization after training is really easy to do, and while doing it during training is more work, it leads to reduced bias and better results.


##### Pruning






[^1]: [LLMs-in-Production](https://github.com/IMJONEZZ/LLMs-in-Production) 
[^2]: [livebook](https://livebook.manning.com/book/llms-in-production)
[^3]: [Attention is All you need](https://arxiv.org/abs/1706.03762)
