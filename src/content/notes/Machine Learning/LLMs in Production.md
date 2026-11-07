
> code ref [LLMs-in-Production](https://github.com/IMJONEZZ/LLMs-in-Production) [livebook](https://livebook.manning.com/book/llms-in-production)

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
